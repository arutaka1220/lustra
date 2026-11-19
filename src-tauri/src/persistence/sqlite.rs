//! The system SQLite API is available on macOS and Windows 11.
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::Path,
    ptr::{null, null_mut},
    slice,
};

#[repr(C)]
struct ConnectionHandle {
    _opaque: [u8; 0],
}

#[repr(C)]
struct StatementHandle {
    _opaque: [u8; 0],
}

#[cfg_attr(windows, link(name = "winsqlite3"))]
#[cfg_attr(not(windows), link(name = "sqlite3"))]
extern "C" {
    fn sqlite3_open_v2(
        filename: *const c_char,
        database: *mut *mut ConnectionHandle,
        flags: c_int,
        vfs: *const c_char,
    ) -> c_int;
    fn sqlite3_close(database: *mut ConnectionHandle) -> c_int;
    fn sqlite3_errmsg(database: *mut ConnectionHandle) -> *const c_char;
    fn sqlite3_busy_timeout(database: *mut ConnectionHandle, milliseconds: c_int) -> c_int;
    fn sqlite3_exec(
        database: *mut ConnectionHandle,
        sql: *const c_char,
        callback: Option<
            unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int,
        >,
        context: *mut c_void,
        message: *mut *mut c_char,
    ) -> c_int;
    fn sqlite3_prepare_v2(
        database: *mut ConnectionHandle,
        sql: *const c_char,
        length: c_int,
        statement: *mut *mut StatementHandle,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_bind_text(
        statement: *mut StatementHandle,
        index: c_int,
        text: *const c_char,
        length: c_int,
        destructor: Option<unsafe extern "C" fn(*mut c_void)>,
    ) -> c_int;
    fn sqlite3_step(statement: *mut StatementHandle) -> c_int;
    fn sqlite3_finalize(statement: *mut StatementHandle) -> c_int;
    fn sqlite3_column_text(statement: *mut StatementHandle, column: c_int) -> *const u8;
    fn sqlite3_column_bytes(statement: *mut StatementHandle, column: c_int) -> c_int;
}

const OK: c_int = 0;
const ROW: c_int = 100;
const DONE: c_int = 101;
const READ_WRITE_CREATE: c_int = 0x02 | 0x04;

pub struct Database(*mut ConnectionHandle);

impl Drop for Database {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // Statement's borrow prevents any statement from outliving this connection.
            unsafe { sqlite3_close(self.0) };
        }
    }
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        let path = path.to_str().ok_or("The database path must be Unicode.")?;
        let path = CString::new(path).map_err(|error| error.to_string())?;
        let mut handle = null_mut();
        // SQLite copies the filename and returns a handle even on most open errors.
        let status =
            unsafe { sqlite3_open_v2(path.as_ptr(), &mut handle, READ_WRITE_CREATE, null()) };
        let database = Self(handle);
        database.check(status)?;
        database.check(unsafe { sqlite3_busy_timeout(database.0, 3000) })?;
        database.exec(
            c"PRAGMA journal_mode=WAL;
              PRAGMA synchronous=FULL;
              CREATE TABLE IF NOT EXISTS records (
                  key TEXT PRIMARY KEY NOT NULL,
                  value TEXT NOT NULL
              );",
        )?;
        Ok(database)
    }

    fn error(&self) -> String {
        if self.0.is_null() {
            return "Could not open the Lustra database.".into();
        }
        // The connection owns its error string. Copy before any other SQLite operation.
        unsafe { CStr::from_ptr(sqlite3_errmsg(self.0)) }
            .to_string_lossy()
            .into_owned()
    }

    fn check(&self, status: c_int) -> Result<(), String> {
        if status == OK {
            Ok(())
        } else {
            Err(self.error())
        }
    }

    fn exec(&self, sql: &CStr) -> Result<(), String> {
        // All statements passed here are static SQL with no external inputs.
        self.check(unsafe { sqlite3_exec(self.0, sql.as_ptr(), None, null_mut(), null_mut()) })
    }

    fn prepare<'database, 'value>(
        &'database self,
        sql: &CStr,
        parameters: &'value [&'value str],
    ) -> Result<Statement<'database, 'value>, String> {
        let mut handle = null_mut();
        self.check(unsafe {
            sqlite3_prepare_v2(self.0, sql.as_ptr(), -1, &mut handle, null_mut())
        })?;
        let statement = Statement {
            handle,
            _database: self,
            _parameters: parameters,
        };
        for (index, value) in parameters.iter().enumerate() {
            let length =
                c_int::try_from(value.len()).map_err(|_| "The saved edit data is too large.")?;
            // SQLite borrows this UTF-8 buffer until the statement is finalized.
            self.check(unsafe {
                sqlite3_bind_text(
                    statement.handle,
                    (index + 1) as c_int,
                    value.as_ptr().cast(),
                    length,
                    None,
                )
            })?;
        }
        Ok(statement)
    }

    pub fn read(&self, key: &str) -> Result<Option<String>, String> {
        let parameters = [key];
        let statement = self.prepare(c"SELECT value FROM records WHERE key = ?1", &parameters)?;
        match statement.step() {
            ROW => {
                // SQLite owns the cell data until the next step or finalize.
                let value = unsafe { sqlite3_column_text(statement.handle, 0) };
                if value.is_null() {
                    return Err(self.error());
                }
                let length = unsafe { sqlite3_column_bytes(statement.handle, 0) } as usize;
                let bytes = unsafe { slice::from_raw_parts(value, length) };
                String::from_utf8(bytes.to_vec())
                    .map(Some)
                    .map_err(|error| error.to_string())
            }
            DONE => Ok(None),
            _ => Err(self.error()),
        }
    }

    pub fn write(&self, key: &str, value: &str) -> Result<(), String> {
        self.exec(c"BEGIN IMMEDIATE")?;
        let result = (|| {
            let parameters = [key, value];
            let statement = self.prepare(
                c"INSERT OR REPLACE INTO records (key, value) VALUES (?1, ?2)",
                &parameters,
            )?;
            if statement.step() != DONE {
                return Err(self.error());
            }
            Ok(())
        })()
        .and_then(|()| self.exec(c"COMMIT"));
        if result.is_err() {
            let _ = self.exec(c"ROLLBACK");
        }
        result
    }
}

struct Statement<'database, 'value> {
    handle: *mut StatementHandle,
    _database: &'database Database,
    _parameters: &'value [&'value str],
}

impl Statement<'_, '_> {
    fn step(&self) -> c_int {
        // The handles and borrowed bound parameters live through this operation.
        unsafe { sqlite3_step(self.handle) }
    }
}

impl Drop for Statement<'_, '_> {
    fn drop(&mut self) {
        unsafe { sqlite3_finalize(self.handle) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn reopened_archive_keeps_only_committed_values() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder = std::env::temp_dir().join(format!("lustra-sqlite-{}-{now}", process::id()));
        fs::create_dir(&folder).unwrap();
        let path = folder.join("sessions.sqlite3");
        let payload = r#"{"camera":"ニコン's Z6 II","undo":["crop"]}"#;
        {
            let database = Database::open(&path).unwrap();
            assert!(database.read("sessions").unwrap().is_none());
            database.write("sessions", payload).unwrap();
            database.write("corrections", "[]").unwrap();
            let wal = folder.join("sessions.sqlite3-wal");
            assert!(wal.is_file());
            database
                .exec(c"BEGIN IMMEDIATE; UPDATE records SET value = 'incomplete';")
                .unwrap();
            let reader = Database::open(&path).unwrap();
            assert_eq!(reader.read("sessions").unwrap().as_deref(), Some(payload));
        }
        {
            let database = Database::open(&path).unwrap();
            assert_eq!(database.read("sessions").unwrap().as_deref(), Some(payload));
            assert_eq!(database.read("corrections").unwrap().as_deref(), Some("[]"));
            database.write("sessions", "{}").unwrap();
            assert_eq!(database.read("sessions").unwrap().as_deref(), Some("{}"));
        }
        fs::remove_dir_all(folder).unwrap();
    }
}

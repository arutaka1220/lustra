#[tauri::command]
pub async fn list_font_families() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(macos::font_families)
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CStr};

    type CfRef = *const c_void;
    const UTF8: u32 = 0x08000100;

    #[link(name = "CoreText", kind = "framework")]
    extern "C" {
        fn CTFontManagerCopyAvailableFontFamilyNames() -> CfRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CfRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CfRef, index: isize) -> CfRef;
        fn CFStringGetLength(string: CfRef) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(string: CfRef, buffer: *mut c_char, size: isize, encoding: u32)
            -> u8;
        fn CFRelease(value: CfRef);
    }

    struct FamilyNames(CfRef);

    impl Drop for FamilyNames {
        fn drop(&mut self) {
            // CoreText returns an owned array under the Copy rule.
            unsafe { CFRelease(self.0) }
        }
    }

    pub fn font_families() -> Result<Vec<String>, String> {
        // The array owns its CFString elements for the duration of enumeration.
        let array = unsafe { CTFontManagerCopyAvailableFontFamilyNames() };
        if array.is_null() {
            return Err("The system font list could not be loaded.".to_owned());
        }
        let names = FamilyNames(array);
        let count = unsafe { CFArrayGetCount(names.0) };
        let mut families = Vec::new();
        for index in 0..count {
            let family = unsafe { CFArrayGetValueAtIndex(names.0, index) };
            let length = unsafe { CFStringGetLength(family) };
            let capacity = unsafe { CFStringGetMaximumSizeForEncoding(length, UTF8) }
                .checked_add(1)
                .filter(|size| *size > 0);
            let Some(capacity) = capacity else {
                continue;
            };
            let mut buffer = vec![0; capacity as usize];
            if unsafe { CFStringGetCString(family, buffer.as_mut_ptr(), capacity, UTF8) } == 0 {
                continue;
            }
            let value = unsafe { CStr::from_ptr(buffer.as_ptr()) }.to_string_lossy();
            if !value.is_empty() {
                families.push(value.into_owned());
            }
        }
        families.sort_unstable();
        families.dedup();
        Ok(families)
    }

    #[cfg(test)]
    mod tests {
        use super::font_families;

        #[test]
        fn lists_installed_font_families() {
            let families = font_families().unwrap();
            assert!(!families.is_empty());
            assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
        }
    }
}

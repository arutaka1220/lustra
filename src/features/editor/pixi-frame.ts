import 'pixi.js/unsafe-eval'
import { Container, Graphics, ImageSource, Sprite, Texture, WebGLRenderer } from 'pixi.js'
import { FrameBackdrop, getInsetStroke } from './frame-paint'
import type { PhotoRaster, PreviewRenderer } from './frame-paint'

export async function createPixiRenderer(): Promise<PreviewRenderer> {
  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer()
  await renderer.init({ canvas, width: 1, height: 1, antialias: true })

  const stage = new Container()
  const picture = new Container()
  const backdrop = new FrameBackdrop()
  const background = new Sprite()
  const photograph = new Sprite()
  const clippingMask = new Graphics()
  const inset = new Graphics()
  picture.mask = clippingMask
  picture.addChild(photograph, inset)
  stage.addChild(background, picture, clippingMask)

  let backgroundTexture: Texture | undefined
  let pictureTexture: Texture | undefined
  let previousRaster: PhotoRaster | undefined
  let viewWidth = 0
  let viewHeight = 0
  let viewDpr = 0

  return {
    canvas,
    render(scene) {
      const { size, raster, dpr, frame, layout: { image, visible } } = scene
      if (viewWidth !== size.width || viewHeight !== size.height || viewDpr !== dpr) {
        renderer.resize(size.width, size.height, dpr)
        viewWidth = size.width
        viewHeight = size.height
        viewDpr = dpr
      }
      if (backdrop.update(scene)) {
        backgroundTexture?.destroy(true)
        backgroundTexture = new Texture({ source: new ImageSource({ resource: backdrop.canvas }) })
        background.texture = backgroundTexture
        background.width = size.width
        background.height = size.height
      }
      if (raster !== previousRaster) {
        pictureTexture?.destroy(true)
        pictureTexture = new Texture({ source: new ImageSource({ resource: raster.image }) })
        photograph.texture = pictureTexture
        previousRaster = raster
      }
      photograph.position.set(image.x, image.y)
      photograph.width = image.width
      photograph.height = image.height
      clippingMask.clear().rect(visible.x, visible.y, visible.width, visible.height).fill(0xffffff)
      inset.clear()
      if (frame.style !== 'none' && frame.showInset) {
        const { rect, weight, color, alpha } = getInsetStroke(scene)
        inset.rect(rect.x, rect.y, rect.width, rect.height).stroke({ width: weight, color, alpha })
      }
      renderer.render(stage)
    },
    dispose() {
      stage.destroy({ children: true })
      backgroundTexture?.destroy(true)
      pictureTexture?.destroy(true)
      renderer.destroy({ removeView: true })
    },
  }
}

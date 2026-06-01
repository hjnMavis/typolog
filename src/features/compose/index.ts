// Compose feature — collage rendering, background selection, PNG export
export { CollagePreviewClient } from "./CollagePreviewClient"
export { getPieceLayout, canPreview } from "./collage-layout"
export type { PieceLayout } from "./collage-layout"
export { buildCollageFilename, shouldUseIosFallback, canExport, downloadCollage } from "./export-collage"
export type { DownloadCollageResult, DownloadCollageOptions, DownloadMode } from "./export-collage"

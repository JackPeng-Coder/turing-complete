/**
 * The board's viewport transform: camera position in world units (the pan
 * offset, screen pixels at zoom 1) plus the zoom factor.
 *
 * Only the type lives here for now -- `app/store.ts` imports it type-only to
 * declare `AppState`. The world/screen conversions, snapping and hit testing
 * that operate on a `Camera` are added by the board task that owns this file.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * The two value types the application state and the board share.
 *
 * They are declared here, in `app/`, rather than beside the board that draws
 * with them, because `AppState` is what holds them: the camera is a field of
 * the state and a drag in flight has an endpoint in it. A type declared in
 * `ui/board/` would make `app/` import upwards, which the layer rule in
 * `test/conventions.test.ts` forbids -- and the rule is worth more than the
 * tidier address, because `ui/` is allowed to read `app/` while the reverse is
 * how a UI layer becomes un-replaceable.
 *
 * Both are pure data with no behaviour, so the board imports them as types
 * only: nothing here is in the runtime graph.
 */

/** A point in board coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Which part of the board is on screen.
 *
 * `x` / `y` are the world point drawn at the top-left corner, in screen pixels
 * at zoom 1. The fields are mutable: the camera is advanced in place by pan,
 * wheel and keyboard gestures rather than rebuilt per frame.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

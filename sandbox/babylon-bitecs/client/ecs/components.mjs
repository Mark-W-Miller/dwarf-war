// bitecs component definitions (SoA)
import { defineComponent, Types } from '../vendor/bitecs-lite.mjs';

// Position + simple uniform scale (rotation omitted for brevity)
export const Transform = defineComponent({ x: Types.f32, y: Types.f32, z: Types.f32, s: Types.f32 });

// Simple path follower order: speed + waypoint index
export const AIOrder = defineComponent({ speed: Types.f32, index: Types.ui16 });

// Index into a Babylon thin instance buffer on a shared mesh
export const ThinIndex = defineComponent({ i: Types.ui32 });

// Tags
export const UnitTag = defineComponent();

// Out-of-band data that doesn't fit SoA well
export const PathStore = new Map(); // entity -> [{x,y,z}, ...]

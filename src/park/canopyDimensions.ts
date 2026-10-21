/** Shared illustrative canopy dimensions used by the 3D model and shade estimate. */
export const CANOPY_ROOF_RADIUS = 2.8;
export const CANOPY_ROOF_PIVOT_HEIGHT = 2.35;
export const CANOPY_ROOF_UNDERSIDE_OFFSET = 0.02;
export const CANOPY_SEAT_RADIUS = 1.03;
/** Prototype-only opening around the fixed support; not an engineering clearance. */
export const CANOPY_SUPPORT_CLEARANCE_RADIUS = 0.5;
/** Provisional movement range for prototype testing, not an engineering limit. */
export const CANOPY_TILT_LIMITS = { min: -30, max: 30 } as const;

/** Provisional fixed occupied area: a 2.7 m diameter circle centred on the trunk. */
export const OCCUPIED_AREA_RADIUS = 1.35;
/** Fixed world-space occupied-area centre; it does not follow canopy transforms. */
export const OCCUPIED_AREA_CENTER_X = 0;
export const OCCUPIED_AREA_CENTER_Z = 0;
/** Regular grid spacing for the ground-area shade estimate, in metres. */
export const SHADE_SAMPLE_SPACING = 0.1;

import '../types.js';

declare module '../types.js' {
  interface ImageOcclusionMask {
    shape?: 'rect' | 'ellipse' | 'polygon' | 'text';
    points?: Array<{ x: number; y: number }>;
    angle?: number;
    fill?: string;
    text?: string;
    occludeInactive?: boolean;
    groupId?: string;
  }

  interface ImageOcclusionCardData {
    masks?: ImageOcclusionMask[];
    mode?: 'hide-all-guess-one' | 'hide-one-guess-one';
    activeOrdinal?: number;
    header?: string;
    comments?: string;
  }
}

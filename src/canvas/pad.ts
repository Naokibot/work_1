interface Point {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  points: Point[];
  eraser: boolean;
}

export class ScratchPad {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private active: Stroke | null = null;
  private eraser = false;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setEraser(enabled: boolean): void {
    this.eraser = enabled;
  }

  clear(): void {
    this.strokes = [];
    this.redoStack = [];
    this.active = null;
    this.redraw();
  }

  undo(): void {
    const stroke = this.strokes.pop();
    if (!stroke) return;
    this.redoStack.push(stroke);
    this.redraw();
  }

  redo(): void {
    const stroke = this.redoStack.pop();
    if (!stroke) return;
    this.strokes.push(stroke);
    this.redraw();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.redraw();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.redoStack = [];
    this.active = { points: [this.point(event)], eraser: this.eraser };
    this.strokes.push(this.active);
    this.redraw();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.canvas.hasPointerCapture(event.pointerId)) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
    for (const item of coalesced) this.active.points.push(this.point(item));
    this.redraw();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.active) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.active = null;
  };

  private point(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: event.pressure > 0 ? event.pressure : 0.5
    };
  }

  private redraw(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    for (const stroke of this.strokes) this.drawStroke(stroke);
  }

  private drawStroke(stroke: Stroke): void {
    if (!stroke.points.length) return;
    this.ctx.save();
    this.ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
    this.ctx.strokeStyle = '#1d1d1f';
    for (let index = 1; index < stroke.points.length; index += 1) {
      const prev = stroke.points[index - 1];
      const current = stroke.points[index];
      if (!prev || !current) continue;
      this.ctx.beginPath();
      this.ctx.lineWidth = stroke.eraser ? 24 : 2.5 + current.pressure * 2.5;
      this.ctx.moveTo(prev.x, prev.y);
      this.ctx.lineTo(current.x, current.y);
      this.ctx.stroke();
    }
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      if (point) {
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, stroke.eraser ? 12 : 2.5, 0, Math.PI * 2);
        this.ctx.fillStyle = '#1d1d1f';
        this.ctx.fill();
      }
    }
    this.ctx.restore();
  }
}

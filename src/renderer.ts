// Minimal WebGPU renderer. Owns the device, swapchain, uniform buffer,
// and a pipeline that is rebuilt each time the shader changes.
// Live controls are plain fields written into the uniform buffer every
// frame — moving a slider never rebuilds the pipeline.

export interface Controls {
  speed: number; zoom: number; panX: number; panY: number;
  warp: number; intensity: number; hue: number; freq: number;
  waves: number; vector: number; tiling: number; shaping: number;
}

export const DEFAULT_CONTROLS: Controls = {
  speed: 1, zoom: 1, panX: 0, panY: 0,
  warp: 0, intensity: 1, hue: 0, freq: 1,
  waves: 1, vector: 1, tiling: 1, shaping: 1,
};

export class Renderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private uniformBuffer!: GPUBuffer;
  private bindGroupLayout!: GPUBindGroupLayout;
  private bindGroup!: GPUBindGroup;
  private pipeline: GPURenderPipeline | null = null;
  private currentShader = '';
  private lastError: string | null = null;

  // Live controls, set directly by the UI sliders in main.ts.
  // speed is applied CPU-side: simTime accumulates dt * speed, so changing
  // speed never makes the animation jump.
  controls: Controls = { ...DEFAULT_CONTROLS };
  private simTime = 0;
  private lastFrame = performance.now();

  constructor(private canvas: HTMLCanvasElement) {}

  async init() {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported. Use Chrome 113+, Edge, or Safari 18+.');
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter found.');
    this.device = await adapter.requestDevice();

    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) throw new Error('Could not get WebGPU context.');
    this.context = ctx;

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });

    // 16 floats = 64 bytes — must match the Uniforms struct in emitter.ts:
    // time, aspect, zoom, warp, intensity, hue, freq, panX, panY,
    // waves, vector, tiling, shaping, 3 pads
    this.uniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  resetControls(): void {
    this.controls = { ...DEFAULT_CONTROLS };
  }

  // Rebuilds the pipeline with a new WGSL source.
  setShader(wgsl: string): { ok: boolean; error: string | null } {
    if (wgsl === this.currentShader) return { ok: true, error: this.lastError };
    this.currentShader = wgsl;
    this.lastError = null;

    try {
      const module = this.device.createShaderModule({ code: wgsl });

      // Attach an error scope to catch compile errors synchronously-ish.
      this.device.pushErrorScope('validation');

      const layout = this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      });

      this.pipeline = this.device.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }],
        },
        primitive: { topology: 'triangle-list' },
      });

      this.device.popErrorScope().then((err) => {
        if (err) {
          console.error('Pipeline validation error:', err.message);
          this.lastError = err.message;
          this.pipeline = null;
        }
      });

      return { ok: true, error: null };
    } catch (e) {
      this.pipeline = null;
      this.lastError = (e as Error).message;
      return { ok: false, error: this.lastError };
    }
  }

  render() {
    if (!this.pipeline) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.simTime += dt * this.controls.speed;

    const c = this.controls;
    const aspect = this.canvas.width / this.canvas.height;
    const uniformData = new Float32Array([
      this.simTime, aspect, c.zoom, c.warp,
      c.intensity, c.hue, c.freq, c.panX,
      c.panY, c.waves, c.vector, c.tiling,
      c.shaping, 0, 0, 0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  startLoop() {
    const loop = () => {
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

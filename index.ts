type lame_t = number;
type lame_ptr = number;
type LameCall = 0 | -1 | -2 | -3;

type hip_t = number;

const enum MPEG_mode {

    STEREO = 0, JOINT_STEREO, DUAL_CHANNEL, MONO, NOT_SET, MAX_INDICATOR

}

const enum vbr_mode {

    vbr_off = 0, vbr_mt, vbr_rh, vbr_abr, vbr_mtrh, vbr_max_indicator, vbr_default = 4

}

declare interface Lame extends EmscriptenModule {

    _lame_init(): lame_t;

    _lame_init_params(gfp: lame_t): LameCall;

    _lame_close(gfp: lame_t): LameCall;

    _lame_set_mode(gfp: lame_t, mode: MPEG_mode): LameCall;

    _lame_set_num_channels(gfp: lame_t, num_channels: number): LameCall;

    _lame_set_in_samplerate(gfp: lame_t, in_samplerate: number): LameCall;

    _lame_set_VBR(gfp: lame_t, VBR: vbr_mode): LameCall;

    _lame_set_VBR_quality(gfp: lame_t, VBR_q: number): LameCall;

    _lame_encode_buffer_ieee_float(gfp: lame_t, pcm_l: lame_ptr, pcm_r: lame_ptr, nsamples: number, mp3buf: lame_ptr, mp3buf_size: number): LameCall | number;

    _lame_encode_flush(gfp: lame_t, mp3buffer: lame_ptr, mp3buffer_size: number): LameCall | number;

    _hip_decode_init(): hip_t;

    _hip_decode_exit(gfp: hip_t): LameCall;

    _hip_decode1(gfp: hip_t, mp3buf: lame_ptr, len: number, pcm_l: lame_ptr, pcm_r: lame_ptr): LameCall | number;

    _hip_decode1_headers(gfp: hip_t, mp3buf: lame_ptr, len: number, pcm_l: lame_ptr, pcm_r: lame_ptr, mp3data: lame_ptr): LameCall;

}

var lame: Lame;
(require('./dist/dlame.js')() as Promise<Lame>)
    .then(_lame => lame = _lame);

namespace Lame {

    const MAX_SAMPLES = 65536;
    const PCM_BUF_SIZE = MAX_SAMPLES * 4;
    const BUF_SIZE = (MAX_SAMPLES * 1.25 + 7200);

    export class Encoder {

        private readonly lame_t: lame_t;

        private readonly buffer: Uint8Array;
        private readonly pcm_buffers: Float32Array[];

        public constructor(sample_rate: number, quality: number) {
            this.lame_t = lame._lame_init();
            this.buffer = new Uint8Array(lame.HEAP8.buffer, lame._malloc(BUF_SIZE));
            this.pcm_buffers = [
                new Float32Array(lame.HEAP8.buffer, lame._malloc(PCM_BUF_SIZE)),
                new Float32Array(lame.HEAP8.buffer, lame._malloc(PCM_BUF_SIZE))
            ];

            lame._lame_set_mode(this.lame_t, MPEG_mode.STEREO);
            lame._lame_set_num_channels(this.lame_t, 2);

            lame._lame_set_in_samplerate(this.lame_t, sample_rate);
            lame._lame_set_VBR(this.lame_t, vbr_mode.vbr_default);
            lame._lame_set_VBR_quality(this.lame_t, quality);

            if (lame._lame_init_params(this.lame_t) < 0) {
                throw new Error('Unable to initialize LAME encoder!');
            }
        }

        public *encode(...data: Float32Array[]): Iterable<Uint8Array> {
            const samples = data[0].length;

            for (let start = 0; start < samples;) {
                const size = Math.min(start + MAX_SAMPLES, samples);

                for (const [i, buffer] of data.entries()) {
                    const chunk = buffer.slice(start, size);
                    this.pcm_buffers[i].set(chunk);
                }

                const _encoded = lame._lame_encode_buffer_ieee_float(
                    this.lame_t,
                    this.pcm_buffers[0].byteOffset,
                    this.pcm_buffers[1].byteOffset,
                    size - start,
                    this.buffer.byteOffset,
                    BUF_SIZE
                );

                start = size;
                yield this.buffer.slice(0, _encoded);
            }
        }

        public flush(): Uint8Array {
            const _encoded = lame._lame_encode_flush(
                this.lame_t,
                this.buffer.byteOffset,
                BUF_SIZE
            );

            return this.buffer.slice(0, _encoded);
        }

        public close(): void {
            lame._lame_close(this.lame_t);
            lame._free(this.buffer.byteOffset);
            lame._free(this.pcm_buffers[0].byteOffset);
            lame._free(this.pcm_buffers[1].byteOffset);
        }

    }

    const MPEG_UCHAR_SIZE = 8192;
    const PCM_SHORT_SIZE = 8192 * 2;

    export class Decoder {

        private readonly hip_t: hip_t;

        private readonly buffer: Uint8Array;
        private readonly pcm_buffers: Int16Array[];

        public constructor() {
            this.hip_t = lame._hip_decode_init();
            this.buffer = new Uint8Array(lame.HEAP8.buffer, lame._malloc(MPEG_UCHAR_SIZE))
            this.pcm_buffers = [
                new Int16Array(lame.HEAP8.buffer, lame._malloc(PCM_SHORT_SIZE)),
                new Int16Array(lame.HEAP8.buffer, lame._malloc(PCM_SHORT_SIZE))
            ];
        }

        public *decode(data: Uint8Array): Iterable<Int16Array[]> {
            for (let i = 0; i < data.length; i += MPEG_UCHAR_SIZE) {
                const chunk = data.slice(i, i + MPEG_UCHAR_SIZE);
                this.buffer.set(chunk, 0);

                for (let _length = chunk.length; ;) {
                    const _decoded = lame._hip_decode1(
                        this.hip_t,
                        this.buffer.byteOffset,
                        _length,
                        this.pcm_buffers[0].byteOffset,
                        this.pcm_buffers[1].byteOffset
                    );

                    if (_decoded == 0) {
                        if (_length == chunk.length) {
                            _length = 0;
                            continue;
                        }

                        break;
                    }

                    _length = 0;

                    yield [
                        this.pcm_buffers[0].slice(0, _decoded),
                        this.pcm_buffers[1].slice(0, _decoded)
                    ];
                }
            }
        }

        public close(): void {
            lame._hip_decode_exit(this.hip_t);
            lame._free(this.buffer.byteOffset);
            lame._free(this.pcm_buffers[0].byteOffset);
            lame._free(this.pcm_buffers[1].byteOffset);
        }

    }

}

export default Lame;
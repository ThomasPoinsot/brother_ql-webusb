import type { Model } from './models';
import { ALL_MODELS } from './models';
import { encodePackBits } from './packbits';

export class BrotherQLRaster {
    model: string;
    data: Uint8Array = new Uint8Array(0);
    page_number: number = 0;
    cut_at_end: boolean = true;
    dpi_600: boolean = false;
    two_color_printing: boolean = false;
    compression_enabled: boolean = false;
    half_cut: boolean = true;
    no_chain_printing: boolean = true;

    private model_info: Model;
    private _mtype: number | null = null;
    private _mwidth: number | null = null;
    private _mlength: number | null = null;
    private _pquality: boolean = true;

    constructor(model: string = 'QL-500') {
        const foundModel = ALL_MODELS.find(m => m.identifier === model);
        if (!foundModel) {
            throw new Error(`Unknown model: ${model}`);
        }
        this.model = model;
        this.model_info = foundModel;
    }

    get model_data(): Model {
        return this.model_info;
    }

    private append(bytes: Uint8Array) {
        const newData = new Uint8Array(this.data.length + bytes.length);
        newData.set(this.data);
        newData.set(bytes, this.data.length);
        this.data = newData;
    }

    add_initialize() {
        this.page_number = 0;
        this.append(new Uint8Array([0x1b, 0x40])); // ESC @
    }

    add_status_information() {
        this.append(new Uint8Array([0x1b, 0x69, 0x53])); // ESC i S
    }

    add_switch_mode() {
        if (!this.model_info.mode_setting) {
            console.warn("Trying to switch mode on a printer that doesn't support it.");
            return;
        }
        this.append(new Uint8Array([0x1b, 0x69, 0x61, 0x01])); // ESC i a
    }

    add_invalidate() {
        const bytes = new Uint8Array(this.model_info.num_invalidate_bytes);
        bytes.fill(0);
        this.append(bytes);
    }

    set mtype(value: number) { this._mtype = value; }
    set mwidth(value: number) { this._mwidth = value; }
    set mlength(value: number) { this._mlength = value; }
    set pquality(value: boolean) { this._pquality = value; }

    add_media_and_quality(rnumber: number) {
        this.append(new Uint8Array([0x1b, 0x69, 0x7a])); // ESC i z
        let valid_flags = 0x80;
        if (this._mtype !== null) valid_flags |= (1 << 1);
        if (this._mwidth !== null) valid_flags |= (1 << 2);
        if (this._mlength !== null) valid_flags |= (1 << 3);
        if (this._pquality) valid_flags |= (1 << 6);

        const payload = new Uint8Array(10);
        payload[0] = valid_flags;
        payload[1] = (this._mtype || 0) & 0xff;
        payload[2] = (this._mwidth || 0) & 0xff;
        payload[3] = (this._mlength || 0) & 0xff;

        // rnumber as Little Endian 4 bytes
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        view.setUint32(4, rnumber, true);

        payload[8] = this.page_number === 0 ? 0 : 1;
        payload[9] = 0;

        this.append(payload);
    }

    add_autocut(autocut: boolean = false) {
        if (!this.model_info.cutting) return;
        this.append(new Uint8Array([0x1b, 0x69, 0x4d, autocut ? 0x40 : 0x00])); // ESC i M
    }

    add_cut_every(n: number = 1) {
        if (!this.model_info.cutting) return;
        if (this.model.startsWith('PT')) return;
        this.append(new Uint8Array([0x1b, 0x69, 0x41, n & 0xff])); // ESC i A
    }

    add_expanded_mode() {
        if (!this.model_info.expanded_mode) return;
        this.append(new Uint8Array([0x1b, 0x69, 0x4b])); // ESC i K
        let flags = 0x00;
        if (this.model.startsWith('PT')) {
            if (this.half_cut) flags |= (1 << 2);
            if (this.no_chain_printing) flags |= (1 << 3);
            if (this.dpi_600) flags |= (1 << 5);
        } else {
            if (this.cut_at_end) flags |= (1 << 3);
            if (this.dpi_600) flags |= (1 << 6);
            if (this.two_color_printing) flags |= (1 << 0);
        }
        this.append(new Uint8Array([flags]));
    }

    add_margins(dots: number = 0x23) {
        this.append(new Uint8Array([0x1b, 0x69, 0x64])); // ESC i d
        const bytes = new Uint8Array(2);
        const view = new DataView(bytes.buffer);
        view.setUint16(0, dots, true);
        this.append(bytes);
    }

    add_compression(enable: boolean = true) {
        if (!this.model_info.compression_support) return;
        this.compression_enabled = enable;
        this.append(new Uint8Array([0x4d, enable ? 0x02 : 0x00])); // M
    }

    get_pixel_width(): number {
        return this.model_info.number_bytes_per_row * 8;
    }

    /**
     * Add image data to the protocol.
     * @param image_data Uint8Array of bytes (1 bit per pixel, bit 7 is leftmost pixel)
     * @param second_image_data Optional second color layer
     * @param width Width of image in pixels
     * @param height Height of image in pixels
     */
    add_raster_data(image_data: Uint8Array, second_image_data?: Uint8Array, width: number = 0, height: number = 0) {
        const expected_width = this.get_pixel_width();
        if (width !== expected_width) {
            throw new Error(`Wrong pixel width: ${width}, expected ${expected_width}`);
        }

        const row_len = width / 8;
        const num_rows = height;

        for (let y = 0; y < num_rows; y++) {
            const rows = [image_data.slice(y * row_len, (y + 1) * row_len)];
            if (second_image_data) {
                rows.push(second_image_data.slice(y * row_len, (y + 1) * row_len));
            }

            for (let i = 0; i < rows.length; i++) {
                let row = rows[i];
                if (this.compression_enabled) {
                    row = encodePackBits(row) as any;
                }

                const translen = row.length;
                if (this.model.startsWith('PT')) {
                    this.append(new Uint8Array([0x47, translen & 0xff, (translen >> 8) & 0xff]));
                } else {
                    if (second_image_data) {
                        this.append(new Uint8Array([0x77, i === 0 ? 0x01 : 0x02]));
                    } else {
                        this.append(new Uint8Array([0x67, 0x00]));
                    }
                    this.append(new Uint8Array([translen & 0xff]));
                }
                this.append(row);
            }
        }
    }

    add_print(last_page: boolean = true) {
        this.append(new Uint8Array([last_page ? 0x1a : 0x0c]));
    }

    clear() {
        this.data = new Uint8Array(0);
    }
}

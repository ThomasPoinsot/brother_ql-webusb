export class BrotherQLUSB {
    static readonly VENDOR_ID = 0x04f9;

    device: USBDevice | null = null;
    private endpointOut: number = 0;
    private endpointIn: number = 0;

    async requestDevice(): Promise<USBDevice> {
        this.device = await (navigator as any).usb.requestDevice({
            filters: [{ vendorId: BrotherQLUSB.VENDOR_ID }]
        });
        return this.device!;
    }

    async open(): Promise<void> {
        if (!this.device) throw new Error('No device selected');

        await this.device.open();
        if (this.device.configuration === null) {
            await this.device.selectConfiguration(1);
        }
        await this.device.claimInterface(0);

        // Find endpoints
        const alternate = this.device.configuration!.interfaces[0].alternates[0];
        const out = alternate.endpoints.find((e: any) => e.direction === 'out');
        const bIn = alternate.endpoints.find((e: any) => e.direction === 'in');

        if (!out || !bIn) {
            throw new Error('Endpoints not found');
        }

        this.endpointOut = out.endpointNumber;
        this.endpointIn = bIn.endpointNumber;
    }

    async send(data: Uint8Array): Promise<void> {
        if (!this.device || !this.endpointOut) throw new Error('Device not open');

        // Brother printers usually expect data in chunks, but transferOut handles this
        // Some models might have issues with large buffers, but we'll try direct first
        const result = await (this.device as any).transferOut(this.endpointOut, data);
        if (result.status !== 'ok') {
            throw new Error(`Transfer failed: ${result.status}`);
        }
    }

    async receive(length: number): Promise<DataView> {
        if (!this.device || !this.endpointIn) throw new Error('Device not open');
        const result = await (this.device as any).transferIn(this.endpointIn, length);
        if (result.status !== 'ok') {
            throw new Error(`Transfer in failed: ${result.status}`);
        }
        return result.data;
    }

    async close(): Promise<void> {
        if (this.device) {
            await this.device.close();
            this.device = null;
        }
    }
}

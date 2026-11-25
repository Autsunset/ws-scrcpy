const BITS_PER_MEGABIT = 1_000_000;
const MIN_BITRATE = 0.1;
const MAX_BITRATE = 64;
const PRESETS = [0.5, 1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];

export class BitrateControl {
    public readonly element = document.createElement('div');
    public readonly input = document.createElement('input');
    private readonly presets = document.createElement('select');
    private readonly slider = document.createElement('input');

    constructor(id: string) {
        this.element.className = 'bitrate-control';
        this.input.id = id;
        this.input.type = 'number';
        this.input.min = String(MIN_BITRATE);
        this.input.max = String(MAX_BITRATE);
        this.input.step = 'any';
        this.input.required = true;
        this.input.placeholder = `${MIN_BITRATE}–${MAX_BITRATE}`;
        this.slider.type = 'range';
        this.slider.min = String(MIN_BITRATE);
        this.slider.max = String(MAX_BITRATE);
        this.slider.step = '0.1';
        this.slider.setAttribute('aria-label', '视频码率滑块');
        this.slider.oninput = () => {
            this.input.value = this.slider.value;
            this.syncControls();
        };
        this.presets.setAttribute('aria-label', '视频码率预设');
        this.presets.add(new Option('自定义', ''));
        PRESETS.forEach((rate) => this.presets.add(new Option(`${rate} Mbps`, String(rate))));
        this.presets.onchange = () => {
            if (this.presets.value) {
                this.input.value = this.presets.value;
                this.syncControls();
            } else {
                this.input.focus();
            }
        };
        this.input.oninput = () => this.syncControls();
        this.element.append(this.slider, this.input, this.presets);
        this.setValue(8 * BITS_PER_MEGABIT);
    }

    private syncControls(): void {
        const value = this.input.valueAsNumber;
        if (this.input.validity.valid) {
            this.slider.value = String(value);
            this.slider.setAttribute('aria-valuetext', `${value} Mbps`);
        }
        this.presets.value = PRESETS.includes(value) ? String(value) : '';
    }

    public setValue(bitrate: number): void {
        this.input.value = String(bitrate / BITS_PER_MEGABIT);
        this.syncControls();
    }

    public readValue(): number | undefined {
        return this.input.reportValidity() ? Math.round(this.input.valueAsNumber * BITS_PER_MEGABIT) : undefined;
    }
}

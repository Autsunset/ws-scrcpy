import { TrackerChangeSet } from '@dead50f7/adbkit/lib/TrackerChangeSet';
import { Device } from '../Device';
import { Service } from '../../services/Service';
import AdbKitClient from '@dead50f7/adbkit/lib/adb/client';
import { AdbExtended } from '../adb';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import Tracker from '@dead50f7/adbkit/lib/adb/tracker';
import Timeout = NodeJS.Timeout;
import { BaseControlCenter } from '../../services/BaseControlCenter';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import * as os from 'os';
import * as crypto from 'crypto';
import { DeviceState } from '../../../common/DeviceState';
import { DeviceReadiness } from '../../../common/DeviceReadiness';

export class ControlCenter extends BaseControlCenter<GoogDeviceDescriptor> implements Service {
    private static readonly defaultWaitAfterError = 1000;
    private static instance?: ControlCenter;

    private initialized = false;
    private client: AdbKitClient = AdbExtended.createClient();
    private tracker?: Tracker;
    private waitAfterError = 1000;
    private restartTimeoutId?: Timeout;
    private readinessProbe?: { expiresAt: number; runningDevices: Promise<Device[]> };
    private deviceMap: Map<string, Device> = new Map();
    private descriptors: Map<string, GoogDeviceDescriptor> = new Map();
    private readonly id: string;

    protected constructor() {
        super();
        const idString = `goog|${os.hostname()}|${os.uptime()}`;
        this.id = crypto.createHash('md5').update(idString).digest('hex');
    }

    public static getInstance(): ControlCenter {
        if (!this.instance) {
            this.instance = new ControlCenter();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!ControlCenter.instance;
    }

    private restartTracker = (): void => {
        if (this.restartTimeoutId) {
            return;
        }
        console.log(`Device tracker is down. Will try to restart in ${this.waitAfterError}ms`);
        this.initialized = false;
        this.readinessProbe = undefined;
        this.restartTimeoutId = setTimeout(() => {
            this.restartTimeoutId = undefined;
            this.stopTracker();
            this.waitAfterError = Math.min(30_000, this.waitAfterError * 1.2);
            void this.start();
        }, this.waitAfterError);
    };

    private onChangeSet = (changes: TrackerChangeSet): void => {
        this.waitAfterError = ControlCenter.defaultWaitAfterError;
        if (changes.added.length || changes.removed.length || changes.changed.length) {
            this.readinessProbe = undefined;
        }
        if (changes.added.length) {
            for (const item of changes.added) {
                const { id, type } = item;
                this.handleConnected(id, type);
            }
        }
        if (changes.removed.length) {
            for (const item of changes.removed) {
                const { id } = item;
                this.handleConnected(id, DeviceState.DISCONNECTED);
            }
        }
        if (changes.changed.length) {
            for (const item of changes.changed) {
                const { id, type } = item;
                this.handleConnected(id, type);
            }
        }
    };

    private onDeviceUpdate = (device: Device): void => {
        const { udid, descriptor } = device;
        this.descriptors.set(udid, descriptor);
        this.emit('device', descriptor);
    };

    private handleConnected(udid: string, state: string): void {
        let device = this.deviceMap.get(udid);
        if (device) {
            device.setState(state);
        } else {
            device = new Device(udid, state);
            device.on('update', this.onDeviceUpdate);
            this.deviceMap.set(udid, device);
            this.onDeviceUpdate(device);
        }
    }

    public async init(): Promise<void> {
        if (this.initialized) {
            return;
        }
        this.tracker = await this.startTracker();
        const list = await this.client.listDevices();
        const activeIds = new Set(list.map((device) => device.id));
        this.deviceMap.forEach((device, udid) => {
            if (!activeIds.has(udid) && device.descriptor.state !== DeviceState.DISCONNECTED) {
                this.handleConnected(udid, DeviceState.DISCONNECTED);
            }
        });
        list.forEach((device) => {
            const { id, type } = device;
            this.handleConnected(id, type);
        });
        this.initialized = this.restartTimeoutId === undefined;
    }

    private async startTracker(): Promise<Tracker> {
        if (this.tracker) {
            return this.tracker;
        }
        const tracker = await this.client.trackDevices();
        tracker.on('changeSet', this.onChangeSet);
        tracker.on('end', this.restartTracker);
        tracker.on('error', this.restartTracker);
        return tracker;
    }

    private stopTracker(): void {
        if (this.tracker) {
            this.tracker.off('changeSet', this.onChangeSet);
            this.tracker.off('end', this.restartTracker);
            this.tracker.off('error', this.restartTracker);
            this.tracker.end();
            this.tracker = undefined;
        }
        this.tracker = undefined;
        this.initialized = false;
    }

    public getDevices(): GoogDeviceDescriptor[] {
        return Array.from(this.descriptors.values());
    }

    public async getReadiness(): Promise<DeviceReadiness> {
        if (!this.initialized) {
            return 'adb_unavailable';
        }
        const target = process.env.WS_SCRCPY_ADB_TARGET;
        const connected = Array.from(this.deviceMap.values()).filter(
            (device) => device.isConnected() && (!target || device.udid === target),
        );
        if (!connected.length) {
            return 'no_device';
        }
        const now = Date.now();
        if (!this.readinessProbe || this.readinessProbe.expiresAt <= now) {
            this.readinessProbe = { expiresAt: now + 4000, runningDevices: this.probeScrcpy(connected) };
        }
        const running = await this.readinessProbe.runningDevices;
        if (!this.initialized) {
            return 'adb_unavailable';
        }
        if (!connected.some((device) => device.isConnected())) {
            return 'no_device';
        }
        return running.some((device) => device.isConnected()) ? 'ready' : 'scrcpy_not_running';
    }

    private async probeScrcpy(devices: Device[]): Promise<Device[]> {
        const checks = devices.map((device) => device.isScrcpyRunning().catch(() => false));
        let timeout: Timeout | undefined;
        try {
            return await Promise.race([
                Promise.all(checks).then((running) => devices.filter((_device, index) => running[index])),
                new Promise<Device[]>((resolve) => {
                    timeout = setTimeout(() => resolve([]), 2000);
                }),
            ]);
        } finally {
            clearTimeout(timeout);
        }
    }

    public getDevice(udid: string): Device | undefined {
        return this.deviceMap.get(udid);
    }

    public getId(): string {
        return this.id;
    }

    public getName(): string {
        return `aDevice Tracker [${os.hostname()}]`;
    }

    public start(): Promise<void> {
        return this.init().catch((e) => {
            console.error(`Error: Failed to init "${this.getName()}". ${e.message}`);
            this.restartTracker();
        });
    }

    public release(): void {
        clearTimeout(this.restartTimeoutId);
        this.restartTimeoutId = undefined;
        this.readinessProbe = undefined;
        this.stopTracker();
    }

    public async runCommand(command: ControlCenterCommand): Promise<void> {
        const udid = command.getUdid();
        const device = this.getDevice(udid);
        if (!device) {
            console.error(`Device with udid:"${udid}" not found`);
            return;
        }
        const type = command.getType();
        switch (type) {
            case ControlCenterCommand.KILL_SERVER:
                await device.killServer(command.getPid());
                return;
            case ControlCenterCommand.START_SERVER:
                await device.startServer();
                return;
            case ControlCenterCommand.UPDATE_INTERFACES:
                await device.updateInterfaces();
                return;
            default:
                throw new Error(`Unsupported command: "${type}"`);
        }
    }
}

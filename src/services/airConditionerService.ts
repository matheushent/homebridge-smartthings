import { PlatformAccessory, CharacteristicValue, Service } from 'homebridge';
import { IKHomeBridgeHomebridgePlatform } from '../platform';
import { MultiServiceAccessory } from '../multiServiceAccessory';
import { Command } from './smartThingsCommand';
import { ShortEvent } from '../webhook/subscriptionHandler';
import { BaseService } from './baseService';

enum AirConditionerMode {
  Auto = "auto",
  Cool = "cool",
  Dry = "dry",
  Heat = "heat",
  Wind = "wind"
}

enum TemperatureUnit {
  Celsius = "C",
  Farenheit = "F"
}

enum FanMode {
  Auto = "auto",
  Low = "low",
  Medium = "medium",
  High = "high",
  Turbo = "turbo"
}

enum FanOscillationMode {
  All = "all",
  Fixed = "fixed",
  Vertical = "vertical"
}

enum SwitchState {
  On = "on",
  Off = "off"
}

export class AirConditionerService extends BaseService {

  private temperatureUnit: TemperatureUnit = TemperatureUnit.Celsius

  private thermostatService: Service
  private fanService: Service
  private humidityService: Service | undefined

  constructor(platform: IKHomeBridgeHomebridgePlatform, accessory: PlatformAccessory, componentId: string, capabilities: string[],
    multiServiceAccessory: MultiServiceAccessory,
    name: string, deviceStatus) {
    super(platform, accessory, componentId, capabilities, multiServiceAccessory, name, deviceStatus);

    this.log.debug(`Adding AirConditionerService to ${this.name}`);

    // Since Homekit does not natively support air conditioners, we need to expose
    // a thermostat and a fan to cover temperature settings, fan speed, and swing.
    this.thermostatService = this.setupThermostat(platform, multiServiceAccessory);
    this.fanService = this.setupFan(platform, multiServiceAccessory);

    // Exposing this sensor is optional since some Samsung air conditioner always report 0 as relative humidity level
    if (this.platform.config.ExposeHumiditySensorForAirConditioners)
      this.humidityService = this.setupHumiditySensor(platform, multiServiceAccessory);
  }



  private setupThermostat(platform: IKHomeBridgeHomebridgePlatform, multiServiceAccessory: MultiServiceAccessory): Service {
    this.log.debug(` Expose Thermostat for ${this.name}`);

    // add thermostat service
    this.setServiceType(platform.Service.Thermostat);

    this.service.getCharacteristic(platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service.getCharacteristic(platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(platform.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this));

    multiServiceAccessory.startPollingState(this.platform.config.PollSensorsSeconds, this.getCurrentHeatingCoolingState.bind(this), this.service,
      platform.Characteristic.CurrentHeatingCoolingState, platform.Characteristic.TargetHeatingCoolingState,
      this.getTargetHeatingCoolingState.bind(this));

    multiServiceAccessory.startPollingState(this.platform.config.PollSensorsSeconds, this.getCurrentTemperature.bind(this), this.service,
      platform.Characteristic.CurrentTemperature, platform.Characteristic.TargetTemperature,
      this.getTargetTemperature.bind(this));

    return this.service;
  }

  private setupFan(platform: IKHomeBridgeHomebridgePlatform, multiServiceAccessory: MultiServiceAccessory): Service {
    this.log.debug(`Expose Fan for ${this.name}`);

    this.setServiceType(platform.Service.Fan);

    this.service.getCharacteristic(platform.Characteristic.On)
      .onGet(this.getSwitchState.bind(this))
      .onSet(this.setSwitchState.bind(this));

    this.service.getCharacteristic(platform.Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    this.service.getCharacteristic(platform.Characteristic.RotationSpeed)
      .onSet(this.setFanLevel.bind(this))
      .onGet(this.getFanLevel.bind(this));

    multiServiceAccessory.startPollingState(this.platform.config.PollSensorsSeconds, this.getSwitchState.bind(this), this.service,
      platform.Characteristic.On);

    multiServiceAccessory.startPollingState(this.platform.config.PollSensorsSeconds, this.getFanLevel.bind(this), this.service,
      platform.Characteristic.RotationSpeed);

    return this.service;
  }

  private setupHumiditySensor(platform: IKHomeBridgeHomebridgePlatform, multiServiceAccessory: MultiServiceAccessory): Service {
    this.setServiceType(platform.Service.HumiditySensor);

    this.service.getCharacteristic(platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getHumidityLevel.bind(this));

    multiServiceAccessory.startPollingState(this.platform.config.PollSensorsSeconds, this.getHumidityLevel.bind(this), this.service,
      platform.Characteristic.CurrentRelativeHumidity);

    return this.service;
  }

  private async getHumidityLevel(): Promise<CharacteristicValue> {
    const deviceStatus = await this.getDeviceStatus()
    return deviceStatus.relativeHumidityMeasurement.humidity.value;
  }

  private levelToFanMode(level: number): string {
    if (level > 0 && level < 25)
      return FanMode.Low;

    if (level > 25 && level <= 50)
      return FanMode.Medium;

    if (level > 50 && level <= 75)
      return FanMode.High;

    if (level > 75)
      return FanMode.Turbo;

    return FanMode.Auto;
  }

  private fanModeToLevel(fanMode: FanMode): number {
    switch (fanMode) {
      case FanMode.Low:
        return 25;
      case FanMode.Medium:
        return 50;
      case FanMode.High:
        return 75;
      case FanMode.Turbo:
        return 100;
      default:
        return 0; // auto level  
    }
  }

  private fanOscillationModeToSwingMode(fanOscillationMode: FanOscillationMode): CharacteristicValue {
    switch (fanOscillationMode) {
      case FanOscillationMode.All:
      case FanOscillationMode.Vertical:
        return this.platform.Characteristic.SwingMode.SWING_ENABLED;
      case FanOscillationMode.Fixed:
        return this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }
  }

  // Switch state is managed by the Fan service.
  // If fan is turned on, and thermostat is not active, sets the air conditioner to the Wind mode or mantains the current one.
  private async setSwitchState(value: CharacteristicValue): Promise<void> {
    const CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState;
    const heatingCoolingState = await this.getCurrentHeatingCoolingState();
    const currentAirConditionerMode = this.targetHeatingCoolingStateToAirConditionerMode(heatingCoolingState);
    const airConditionerMode = heatingCoolingState == CurrentHeatingCoolingState.OFF ? AirConditionerMode.Wind : currentAirConditionerMode;
    const switchState = value ? SwitchState.On : SwitchState.Off


    if (switchState === SwitchState.On) {
      this.log.info(`[${this.name}] set switch state to ${switchState} and airConditionerMode to ${airConditionerMode}`);
      await this.sendCommandsOrFail(
        [
          new Command('switch', switchState),
          new Command('airConditionerMode', 'setAirConditionerMode', [airConditionerMode])
        ]
      );
      return;
    }

    this.log.info(`[${this.name}] set switch state to ${switchState}.`);
    await this.sendCommandsOrFail([new Command('switch', switchState)]);
  }


  private async getSwitchState(): Promise<CharacteristicValue> {
    const deviceStatus = await this.getDeviceStatus();
    return deviceStatus.switch.switch.value === SwitchState.On;
  }

  private setFanLevel(value: CharacteristicValue): Promise<void> {
    const fanMode = this.levelToFanMode(value as number);
    const command = new Command('airConditionerFanMode', 'setFanMode', [fanMode]);
    this.log.info(`[${this.name}] set fan level to ${fanMode}`);
    return this.sendCommandsOrFail([command]);
  }

  private async getFanLevel(): Promise<CharacteristicValue> {
    this.log.debug(`[${this.name}] get fan level`);
    const deviceStatus = await this.getDeviceStatus();
    if (!deviceStatus.airConditionerFanMode.fanMode.value)
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST);

    const fanMode = this.deviceStatus.status.airConditionerFanMode.fanMode.value;
    return this.fanModeToLevel(fanMode);
  }


  private setSwingMode(value: CharacteristicValue): Promise<void> {
    const mode = value === this.platform.Characteristic.SwingMode.SWING_ENABLED ? FanOscillationMode.All : FanOscillationMode.Fixed;
    this.log.info(`[${this.name}] set fan swing mode to ${mode}`);
    const command = new Command('fanOscillationMode', 'setFanOscillationMode', [mode]);
    return this.sendCommandsOrFail([command]);
  }


  private async getSwingMode(): Promise<CharacteristicValue> {
    this.log.debug(`[${this.name}] get fan swing mode`);
    const deviceStatus = await this.getDeviceStatus();
    const swingMode = deviceStatus.fanOscillationMode.fanOscillationMode.value as FanOscillationMode
    return this.fanOscillationModeToSwingMode(swingMode);
  }


  private airConditionerModeToTargetHeatingCoolingState(airConditionerMode: AirConditionerMode): CharacteristicValue {
    const TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState
    switch (airConditionerMode) {
      case AirConditionerMode.Dry:
      case AirConditionerMode.Cool:
        return TargetHeatingCoolingState.COOL;
      case AirConditionerMode.Heat:
        return TargetHeatingCoolingState.HEAT;
      case AirConditionerMode.Auto:
        return TargetHeatingCoolingState.AUTO;
      case AirConditionerMode.Wind:
      default:
        return TargetHeatingCoolingState.OFF;
    }
  }

  private targetHeatingCoolingStateToAirConditionerMode(targetHeatingCoolingState: CharacteristicValue): AirConditionerMode | undefined {
    const TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState
    switch (targetHeatingCoolingState) {
      case TargetHeatingCoolingState.AUTO:
        return AirConditionerMode.Auto;
      case TargetHeatingCoolingState.COOL:
        return AirConditionerMode.Cool;
      case TargetHeatingCoolingState.HEAT:
        return AirConditionerMode.Heat
      default:
        return undefined;
    }
  }

  private async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    this.log.debug(`[${this.name}] get target heating cooling state`);
    const deviceStatus = await this.getDeviceStatus()

    const isOff = deviceStatus.switch.switch.value === 'off';
    const airConditionerMode = deviceStatus.airConditionerMode.airConditionerMode.value as AirConditionerMode;

    if (isOff || !airConditionerMode)
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;

    return this.airConditionerModeToTargetHeatingCoolingState(airConditionerMode);
  }

  // Set the target state of the thermostat and turns it on or off by using the switch capability
  private async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    const airConditionerMode = this.targetHeatingCoolingStateToAirConditionerMode(value);
    this.log.info(`[${this.name}] set target heating cooling state to ${airConditionerMode}`);
    // When switching between modes, we always ask to turn on the air conditioner unless 
    // the thermostat is set to off.

    const commands = airConditionerMode ?
      [
        new Command('switch', SwitchState.On),
        new Command('airConditionerMode', 'setAirConditionerMode', [airConditionerMode])
      ]
      :
      [
        new Command('switch', SwitchState.Off),
      ]

    await this.sendCommandsOrFail(commands);
  }


  private async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    this.log.debug(`[${this.name}] get current heating cooling state`);
    const deviceStatus = await this.getDeviceStatus();
    const CurrentHeatingCoolingState = this.platform.Characteristic.CurrentHeatingCoolingState
    const airConditionerMode = deviceStatus.airConditionerMode.airConditionerMode.value as AirConditionerMode;
    const coolingSetpoint = this.toCelsius(deviceStatus.thermostatCoolingSetpoint.coolingSetpoint.value);
    const temperature = this.toCelsius(deviceStatus.temperatureMeasurement.temperature.value)
    const isOff = deviceStatus.switch.switch.value === SwitchState.Off;

    if (isOff)
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;

    switch (airConditionerMode) {
      case AirConditionerMode.Cool:
        return CurrentHeatingCoolingState.COOL;
      case AirConditionerMode.Heat:
        return CurrentHeatingCoolingState.HEAT;
      case AirConditionerMode.Auto:
        return temperature > coolingSetpoint ? CurrentHeatingCoolingState.COOL : CurrentHeatingCoolingState.HEAT
      default:
        return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  private async getCurrentTemperature(): Promise<CharacteristicValue> {
    this.log.debug(`[${this.name}] get current temperature`);

    const deviceStatus = await this.getDeviceStatus()

    const temp = deviceStatus.temperatureMeasurement.temperature.value
    const unit = deviceStatus.temperatureMeasurement.temperature.unit as TemperatureUnit

    if (!temp || !unit)
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST);

    return this.toCelsius(temp);

  }


  private async getTargetTemperature(): Promise<CharacteristicValue> {
    this.log.debug(`[${this.name}] get target temperature`);
    const deviceStatus = await this.getDeviceStatus()
    const coolingSetpoint = deviceStatus.thermostatCoolingSetpoint.coolingSetpoint.value;

    if (!coolingSetpoint)
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST);

    return this.toCelsius(coolingSetpoint);
  }

  private setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.log.info(`[${this.name}] set target temperature to ${value}`);

    const convertedTemp = this.fromCelsius(value as number);
    const command = new Command('thermostatCoolingSetpoint', 'setCoolingSetpoint', [convertedTemp])
    return this.sendCommandsOrFail([command])
  }

  private getTemperatureDisplayUnits(): CharacteristicValue {
    this.log.debug(`[${this.name}] get temperatured dislay units`);
    return this.temperatureUnit === TemperatureUnit.Celsius
      ? this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS
      : this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
  }

  // converts to celsius if needed
  private toCelsius(value: number): number {
    return this.temperatureUnit === TemperatureUnit.Farenheit ? (value - 32) * (5 / 9) : value;
  }

  // converts to fahrenheit if needed
  private fromCelsius(value: number): number {
    return this.temperatureUnit === TemperatureUnit.Farenheit ? (value * (9 / 5)) + 32 : value;
  }

  private async sendCommandsOrFail(commands: Command[]) {
    if (!this.multiServiceAccessory.isOnline) {
      this.log.error(this.name + ' is offline');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (!await this.multiServiceAccessory.sendCommands(commands))
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE)

  }

  private async getDeviceStatus(): Promise<any> {
    this.multiServiceAccessory.forceNextStatusRefresh()
    if (!await this.getStatus())
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    return this.deviceStatus.status
  }

  public processEvent(event: ShortEvent): void {
    const TargetHeatingCoolingState = this.platform.Characteristic.TargetHeatingCoolingState
    this.log.info(`[${this.name}] Event updating ${event.capability} capability to ${event.value}`);
    switch (event.capability) {
      case 'thermostatCoolingSetpoint':
        const temperature = this.toCelsius(event.value);
        this.thermostatService.updateCharacteristic(this.platform.Characteristic.TargetTemperature, temperature);
        break;
      case 'airConditionerMode':
        const targetHeatingCoolingState = this.airConditionerModeToTargetHeatingCoolingState(event.value);
        this.thermostatService.updateCharacteristic(TargetHeatingCoolingState, targetHeatingCoolingState);
        break;
      case 'airConditionerFanMode':
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.fanModeToLevel(event.value));
        break;
      case 'fanOscillationMode':
        const fanOscillationMode = event.value as FanOscillationMode
        this.fanService.updateCharacteristic(this.platform.Characteristic.SwingMode, this.fanOscillationModeToSwingMode(fanOscillationMode));
        break;
      case 'switch':
        this.fanService.updateCharacteristic(this.platform.Characteristic.On, event.value === SwitchState.On);
        break;
      case 'relativeHumidityMeasurement':
        this.humidityService?.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, event.value);
      default:
        this.log.info(`[${this.name}] Ignore event updating ${event.capability} capability to ${event.value}`);
        break;
    }
  }
}
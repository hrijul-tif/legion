// Tiny hand-written catalog used by unit tests (shape = lib/catalog/types.ts).
import type { Catalog } from './types';

export const fixtureCatalog: Catalog = {
  mission: 'FF',
  source: 'fixture',
  generatedAt: '2026-01-01T00:00:00+00:00',
  enums: {
    NullConfigOnoffEnum: {
      members: [
        { name: 'OFF', value: 'Off' },
        { name: 'ON', value: 'On' },
      ],
    },
    PusAckFlagsEnum: {
      members: [
        { name: 'ACCEPTANCE___COMPLETION', value: 'Acceptance | Completion' },
        { name: 'ACCEPTANCE', value: 'Acceptance' },
        { name: 'COMPLETION', value: 'Completion' },
        { name: 'NONE', value: 'None' },
      ],
    },
  },
  paramEnums: {
    AocsModeEnum: {
      members: [
        { name: 'RATE_DAMP', value: 'Rate_Damp' },
        { name: 'FINE_POINTING', value: 'Fine_Pointing' },
      ],
    },
  },
  commands: {
    EPSSwtAocs3v3BkMn: {
      q: '/FF/EPS/Swt_aocs3v3BkMn',
      subsystem: 'EPS',
      args: [
        { name: 'On_Off_State', wire: 'On_Off_State', type: 'enum', enum: 'NullConfigOnoffEnum', required: true },
        { name: 'Pus_Acknowledgement_Flags', wire: 'Pus_Acknowledgement_Flags', type: 'enum', enum: 'PusAckFlagsEnum', required: true },
        { name: 'Command_Timetag', wire: 'Command_Timetag', type: 'datetime', required: false, default: '1970-01-01T00:00:00.000000Z' },
      ],
      fixed: { Logical_Device_ID: 'Taocs3v3RegMn_Swt', Command_ID: 'TonOffSt', Pus_Service_Type: '2' },
    },
    PayloadCaptureImage: {
      q: '/FF/Payload/Capture_Image',
      subsystem: 'Payload',
      description: 'Capture an image with the payload camera.',
      args: [
        { name: 'Exposure_Ms', wire: 'Exposure_Ms', type: 'int', required: true, description: 'Exposure time in milliseconds' },
        { name: 'Gain', wire: 'Gain', type: 'float', required: false, default: 1 },
        { name: 'Pus_Acknowledgement_Flags', wire: 'Pus_Acknowledgement_Flags', type: 'enum', enum: 'PusAckFlagsEnum', required: true },
      ],
      fixed: { Base_ID: 'PLD', Pus_Service_Type: '6' },
    },
    AOCSSetImuPLpfCutFreq: {
      q: '/FF/AOCS/Set_imuPLpfCut_Freq',
      subsystem: 'AOCS',
      args: [
        { name: 'axis', wire: 'axis', type: 'str', required: true },
        { name: 'field_3dBfreq', wire: '3dBfreq', type: 'int', required: true },
      ],
      fixed: {},
    },
  },
  parameters: {
    AOCSAocsMode: {
      q: '/FF/AOCS/Aocs_Mode',
      subsystem: 'AOCS',
      kind: 'enumeration',
      field: 'Aocs_Mode',
      type: 'enum',
      enum: 'AocsModeEnum',
      description: 'AOCS Mode',
    },
    EPSBatteryVoltage: {
      q: '/FF/EPS/Battery_Voltage',
      subsystem: 'EPS',
      kind: 'normal',
      field: 'Battery_Voltage',
      type: 'float',
      description: 'Battery bus voltage in volts',
    },
  },
};

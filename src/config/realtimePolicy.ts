export const REALTIME_POLICY = {
  polling: {
    registrationMs: 15000,
    walkInMs: 12000,
    checkupMs: 10000,
    laboratoryMs: 15000,
    pharmacyMs: 20000,
    patientsMs: 15000,
    reportsMs: 20000
  },
  debounce: {
    registrationSearchMs: 280,
    checkupSearchMs: 260,
    patientsSearchMs: 260
  },
  uiTick: {
    walkInClockMs: 30000
  }
} as const;

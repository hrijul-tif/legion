/** Time warp the run panel starts with. */
export const IDE_PREFS_DEFAULT_WARP = 10;

export const WARP_CHOICES: { label: string; value: number; hint: string }[] = [
  { label: "1×", value: 1, hint: "Real time" },
  { label: "10×", value: 10, hint: "10 spacecraft seconds per second" },
  { label: "100×", value: 100, hint: "100 spacecraft seconds per second" },
  {
    label: "Instant",
    value: Infinity,
    hint: "No waiting: run as fast as the sandbox can",
  },
];

/** Ruff configuration used by the lang worker (and its tests). Target py312, 120 cols, low-noise rule set. */
export const RUFF_SETTINGS = {
  'target-version': 'py312',
  'line-length': 120,
  'indent-width': 4,
  format: { 'indent-style': 'space', 'quote-style': 'double' },
  lint: {
    select: ['E', 'F', 'W', 'B', 'UP'],
    ignore: [
      'E501', // line length: formatter handles it, long f-strings are normal in procedures
      'F403', 'F405', // star-import noise (not applicable to the sandbox anyway)
      'UP006', 'UP007', 'UP035', 'UP045', // typing.List/Optional are valid MOS annotations
      'UP031', 'UP032', // %-format / .format modernisation is noise for operators
      'B008', 'B905',
    ],
  },
};

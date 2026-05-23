#!/usr/bin/env node
/**
 * @deprecated Use tools/train_letter_writing_model.py (TensorFlow/Keras — fast).
 * Pure JS tfjs in Node is too slow for conv training.
 */
console.error('Use: python tools/train_letter_writing_model.py');
process.exit(1);

/**
 * Helper for temporary local storage that resets daily.
 * Useful for caching API responses or user preferences that should refresh frequently.
 */

export const tempStorage = {
  get: <T>(key: string): T | null => {
    try {
      const item = localStorage.getItem(`kora_temp_${key}`);
      if (!item) return null;

      const { value, expiry } = JSON.parse(item);
      if (Date.now() > expiry) {
        localStorage.removeItem(`kora_temp_${key}`);
        return null;
      }
      return value as T;
    } catch (e) {
      return null;
    }
  },

  set: <T>(key: string, value: T, ttlHours: number = 24): void => {
    try {
      const expiry = Date.now() + ttlHours * 60 * 60 * 1000;
      localStorage.setItem(`kora_temp_${key}`, JSON.stringify({ value, expiry }));
    } catch (e) {
      console.warn("tempStorage.set failed:", e);
    }
  },

  remove: (key: string): void => {
    localStorage.removeItem(`kora_temp_${key}`);
  }
};

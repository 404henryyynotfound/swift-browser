'use strict';

/* Tiny atomic JSON store. No dependencies, no telemetry, no network. */

const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = {};
    this._timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.data = parsed;
      }
    } catch (error) {
      console.warn('[swift] could not read store:', error.message);
    }
  }

  get(key, fallback) {
    const value = this.data[key];
    return value === undefined ? fallback : value;
  }

  set(key, value) {
    this.data[key] = value;
    this.saveSoon();
    return value;
  }

  saveSoon() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.save(), 350);
  }

  save() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const temp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(temp, this.file);
    } catch (error) {
      console.warn('[swift] could not save store:', error.message);
    }
  }
}

module.exports = Store;

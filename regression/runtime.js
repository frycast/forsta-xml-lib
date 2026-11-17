// Evaluated INSIDE the VM. No host objects, callbacks, modules, or I/O are injected.
// This is a deliberately small model, not an implementation of the Forsta engine.
((fixture) => {
  const clone = value => JSON.parse(JSON.stringify(value, (_, item) => {
    if (item === undefined || typeof item === 'function' || typeof item === 'bigint' ||
        (typeof item === 'number' && !Number.isFinite(item))) {
      throw new Error('Mock contract: value cannot be represented as finite JSON data');
    }
    return item;
  }));
  const own = (object, key) => Object.hasOwn(object, key);
  const fail = message => { throw new Error(`Mock contract: ${message}`); };
  const state = {
    fields: clone(fixture.fields || {}), respondent: clone(fixture.respondent || {}),
    environment: clone(fixture.environment || {}), effects: [], trace: [],
    validationFailed: false, messages: [], httpUsed: 0,
  };
  const trace = (api, args) => {
    if (state.trace.length >= 10000) fail('trace limit exceeded');
    state.trace.push({ api, args: clone(args) });
  };
  const value = x => x instanceof Field ? x.get() : x;
  const values = x => x === null || x === '' ? [] : Array.isArray(x) ? x : [x];
  const read = (object, key, description) => {
    if (!own(object, key)) fail(`undeclared ${description} ${key}; use null for an explicit missing value`);
    return clone(object[key]);
  };
  const effect = (api, args) => {
    args = args.map(value);
    trace(api, args);
    state.effects.push({ api, args: clone(args) });
  };

  class Field {
    constructor(id, indices = []) {
      this.id = String(value(id));
      this.indices = indices.map(x => String(value(x)));
      this.key = this.id + this.indices.map(x => `[${x}]`).join('');
    }
    get() { return read(state.fields, this.key, 'field'); }
    set(input) {
      read(state.fields, this.key, 'field');
      let result = value(input);
      const type = (fixture.types || {})[this.id];
      if (result !== null && !this.indices.length) {
        if (type === 'Single') {
          if (Array.isArray(result)) {
            if (result.length !== 1) fail(`cannot assign ${result.length} codes to single ${this.id}`);
            result = result[0];
          }
          result = String(result);
        } else if (type === 'Multi') result = values(result).map(String);
      }
      if (result === undefined) fail(`undefined write to ${this.key}`);
      state.fields[this.key] = clone(result);
      trace('f.set', [this.key, result]);
    }
    item(code) { return new Field(this.id, [...this.indices, code]); }
    any(...codes) { return values(this.get()).some(x => codes.flat().map(String).includes(String(x))); }
    none(...codes) { return !this.any(...codes); }
    all(...codes) { return codes.flat().every(code => this.any(code)); }
    size() { return values(this.get()).length; }
    toBoolean() { return this.size() > 0; }
    toNumber() {
      const result = this.get();
      if (Array.isArray(result) && result.length > 1) fail(`numeric coercion of multicode ${this.key}`);
      return Number(result);
    }
    toString() { const result = this.get(); return result === null ? '' : String(result); }
    valueOf() { const result = this.get(); return result === null ? '' : Array.isArray(result) ? result.join(',') : result; }
    getNoResponseValue() { return read(fixture.noResponse || {}, this.key, 'noResponse'); }
    domainValues() { return read(fixture.domains || {}, this.id, 'domain'); }
    categories() { return this.domainValues(); }
    label() {
      if (!this.indices.length) fail('label() requires item(code) in this model');
      return read((fixture.labels || {})[this.id] || {}, this.indices.at(-1), `label for ${this.id}`);
    }
    valueLabel() { return read((fixture.labels || {})[this.id] || {}, String(this.get()), `label for ${this.id}`); }
  }

  const environment = key => read(state.environment, key, 'environment');
  Object.assign(globalThis, {
    f: (id, ...indices) => new Field(id, indices),
    CurrentForm: () => environment('currentForm'),
    CurrentLang: () => environment('language'),
    GetSurveyChannel: () => environment('channel'),
    IsInProductionMode: () => environment('production'),
    IsInRdgMode: () => environment('rdg'),
    GetStatus: () => environment('status'),
    GetExtendedStatus: () => environment('extendedStatus'),
    GetRespondentValue: key => read(state.respondent, String(key), 'respondent field'),
    SetRespondentValue: (key, input) => {
      read(state.respondent, String(key), 'respondent field');
      state.respondent[key] = clone(value(input));
      effect('SetRespondentValue', [key, input]);
    },
    SetStatus: input => {
      state.environment.status = value(input);
      effect('SetStatus', [input]);
    },
    SetExtendedStatus: input => {
      state.environment.extendedStatus = value(input);
      effect('SetExtendedStatus', [input]);
    },
    SetPanelistCredit: (...args) => {
      if (args.length !== 4) fail('SetPanelistCredit expects four arguments');
      effect('SetPanelistCredit', args); // Record every attempt; never invent remote deduplication.
    },
    Redirect: (...args) => {
      effect('Redirect', args);
      const error = new Error('Redirect');
      error.forstaHalt = 'redirect';
      throw error;
    },
    RaiseError: () => { state.validationFailed = true; trace('RaiseError', []); },
    ClearErrorMessage: () => { trace('ClearErrorMessage', []); },
    ClearQuestionErrorMessage: () => { state.messages = []; trace('ClearQuestionErrorMessage', []); },
    SetQuestionErrorMessage: (language, message) => {
      state.messages.push({ language, message });
      trace('SetQuestionErrorMessage', [language, message]);
    },
    LangIDs: Object.freeze({ en: 9, en_gb: 2057, en_au: 3081 }),
    Request: Object.freeze({ QueryString: Object.freeze({
      item: key => read(fixture.query || {}, key, 'query parameter'),
    }) }),
  });

  // Exact FIFO HTTP expectations: nothing can fall through to a network client.
  const canonical = x => JSON.stringify(x, function (_, v) {
    return v && !Array.isArray(v) && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
  });
  globalThis.Http = Object.freeze(Object.fromEntries(['Get', 'Post', 'Put', 'Delete'].map(method => [method, (...args) => {
    const expected = (fixture.http || [])[state.httpUsed];
    if (!expected || expected.method !== method || canonical(expected.args) !== canonical(args)) {
      trace(`Http.${method} (unmatched)`, args);
      fail(`unexpected Http.${method} call #${state.httpUsed + 1}`);
    }
    state.httpUsed++;
    effect(`Http.${method}`, args);
    if (expected.error) throw new Error(expected.error);
    return clone(expected.response);
  }])));

  // Pin time and pseudorandom values. Local-time methods use the runner's UTC TZ.
  const NativeDate = Date;
  const now = NativeDate.parse(fixture.now || '2026-01-01T00:00:00.000Z');
  if (!Number.isFinite(now)) fail('invalid fixed clock');
  function FixedDate(...args) {
    if (!new.target) return new NativeDate(now).toString();
    return args.length ? new NativeDate(...args) : new NativeDate(now);
  }
  FixedDate.prototype = NativeDate.prototype;
  FixedDate.prototype.constructor = FixedDate;
  FixedDate.now = () => now;
  FixedDate.parse = NativeDate.parse;
  FixedDate.UTC = NativeDate.UTC;
  globalThis.Date = FixedDate;
  globalThis.Intl = undefined;
  let seed = (fixture.seed ?? 1) >>> 0;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Locale formatting depends on ICU/platform versions. Require explicit modelling.
  for (const method of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
    NativeDate.prototype[method] = () => fail(`Date.${method} is not modelled`);
  }
  globalThis.__snapshot = () => JSON.stringify(state);
  globalThis.__setCurrentForm = id => { state.environment.currentForm = id; };
})(JSON.parse(__fixtureJSON));
delete globalThis.__fixtureJSON;

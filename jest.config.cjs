/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Strip .js extension from relative imports so Jest finds the .ts source files
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^#config$': '<rootDir>/src/config.ts',
    '^#db/(.*)$': '<rootDir>/src/db/$1.ts',
    '^#models/(.*)$': '<rootDir>/src/db/models/$1.ts',
    '^#collector/(.*)$': '<rootDir>/src/collector/$1.ts',
    '^#detector/(.*)$': '<rootDir>/src/detector/$1.ts',
    '^#incident/(.*)$': '<rootDir>/src/incident/$1.ts',
    '^#ai/(.*)$': '<rootDir>/src/ai/$1.ts',
    '^#executor/(.*)$': '<rootDir>/src/executor/$1.ts',
    '^#analytics/(.*)$': '<rootDir>/src/analytics/$1.ts',
    '^#scheduler/(.*)$': '<rootDir>/src/scheduler/$1.ts',
    '^#comms/(.*)$': '<rootDir>/src/comms/$1.ts',
    '^#api/(.*)$': '<rootDir>/src/api/$1.ts',
    '^#utils/(.*)$': '<rootDir>/src/utils/$1.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        isolatedModules: true,
        esModuleInterop: true,
      },
      diagnostics: { ignoreCodes: [151002] },
    }],
  },
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageThreshold: {
    global: { branches: 70, functions: 80, lines: 80, statements: 80 },
  },
  testTimeout: 30000,
};

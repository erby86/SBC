/**
 * Import direction rules (ADR-0009). CI fails on any violation.
 * - apps/web            -> packages/shared, packages/ui only
 * - apps/api, worker    -> packages/db, packages/shared only
 * - packages/*          -> never apps/*
 * - apps/*              -> never another app
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'web-no-db',
      comment: 'apps/web must never import packages/db',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^packages/db/' },
    },
    {
      name: 'web-allowed-packages',
      comment: 'apps/web may only import packages/shared and packages/ui',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^packages/', pathNot: '^packages/(shared|ui)/' },
    },
    {
      name: 'backend-allowed-packages',
      comment: 'apps/api and apps/worker may only import packages/db and packages/shared',
      severity: 'error',
      from: { path: '^apps/(api|worker)/' },
      to: { path: '^packages/', pathNot: '^packages/(db|shared)/' },
    },
    {
      name: 'packages-no-apps',
      comment: 'packages/* must never import apps/*',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-no-cross-import',
      comment: 'an app must not import another app',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|\\.turbo)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
  },
};

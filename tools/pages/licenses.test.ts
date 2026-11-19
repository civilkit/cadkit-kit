import { describe, it, expect } from 'vitest';
import { groupLicences, renderLicensesHtml } from './licenses.mjs';

const mit = (who: string) => `MIT License\n\nCopyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software.`;

describe('groupLicences', () => {
  it('shows one copy of the MIT text with every copyright line, and one copy of an identical Apache text', () => {
    const g = groupLicences([
      { title: 'MIT: a', text: mit('2026 Alice') }, { title: 'MIT: b', text: mit('2024 Bob') },
      { title: 'Apache License 2.0: x', text: 'Apache License Version 2.0' }, { title: 'Apache License 2.0: y', text: 'Apache License\nVersion 2.0' },
      { title: 'Notice: x', text: 'NOTICE body' },
    ]);
    expect(g.licences.map((l: { title: string }) => l.title)).toEqual(['MIT licence', 'Apache License 2.0']);
    expect(g.licences[0].copyrights).toEqual(['Copyright (c) 2026 Alice', 'Copyright (c) 2024 Bob']);
    expect(g.licences[0].text.startsWith('Permission is hereby granted')).toBe(true);
    expect(g.notices).toHaveLength(1);
  });
});

describe('renderLicensesHtml', () => {
  it('lists components and packages, the licence texts once, and links back to the app', () => {
    const h = renderLicensesHtml({ licences: [{ title: 'MIT: a', text: mit('2026 Alice') }], deps: [{ name: 'preact', version: '10', license: 'MIT', copyright: 'Copyright (c) Jason Miller' }] });
    expect(h).toContain('<code>preact</code>');
    expect(h).toContain('BOSL2');
    expect(h).toContain('Copyright (c) 2026 Alice');
    expect(h).toContain('href="./"');
  });
});

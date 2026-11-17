#!/usr/bin/env node
'use strict';

/**
 * RacePulsePH workspace agent registry validator (read-only).
 * Validates .agents/agents/agents-library.json, YAML frontmatter, rule alignment
 * with antislop, cross-links into .agents/skills/skills-library.json, relative
 * markdown links, em-dash prohibition (R-02), and byte-identical mirror sync.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EM_DASH = '\u2014';
const RULE_ID = /^(R-(0[1-9]|[12]\d|3\d|40)|C-[1-5])$/;

function resolveRepoRoot(cliRoot) {
  if (cliRoot) {
    return path.resolve(cliRoot);
  }
  let dir = path.resolve(__dirname);
  while (true) {
    if (
      fs.existsSync(path.join(dir, 'AGENTS.md')) &&
      fs.existsSync(path.join(dir, '.agents'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(__dirname, '../../../..');
    }
    dir = parent;
  }
}

let repoRoot = resolveRepoRoot(null);

const results = [];
let fails = 0;
let warns = 0;

function pass(name, detail) {
  results.push({ status: 'PASS', name, detail });
}

function warn(name, detail) {
  warns += 1;
  results.push({ status: 'WARN', name, detail });
}

function fail(name, detail) {
  fails += 1;
  results.push({ status: 'FAIL', name, detail });
}

function readJson(relPath) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`missing file: ${relPath}`);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }
  const fields = {};
  const lines = match[1].split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) {
      index += 1;
      continue;
    }
    const key = kv[1];
    const rest = kv[2].trim();
    if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      const buf = [];
      index += 1;
      while (index < lines.length && (/^\s+/.test(lines[index]) || lines[index] === '')) {
        buf.push(lines[index].replace(/^\s{2}/, ''));
        index += 1;
      }
      fields[key] = buf.join(rest.startsWith('>') ? ' ' : '\n').trim();
    } else if (rest === '') {
      const list = [];
      let next = index + 1;
      while (next < lines.length && /^\s*-\s+/.test(lines[next])) {
        list.push(stripQuotes(lines[next].replace(/^\s*-\s+/, '')));
        next += 1;
      }
      if (list.length > 0) {
        fields[key] = list;
        index = next;
      } else {
        fields[key] = '';
        index += 1;
      }
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      fields[key] = rest
        .slice(1, -1)
        .split(',')
        .map((item) => stripQuotes(item))
        .filter(Boolean);
      index += 1;
    } else {
      fields[key] = stripQuotes(rest);
      index += 1;
    }
  }
  return { fields, body: match[2], lines: normalized.split(/\r?\n/).length };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function extractAntislopTiers(coreSkillText) {
  const sections = {
    hardGate: '### Group 1: Hard Gate',
    purposeGate: '### Group 2: Purpose-Gate',
    qualityLocks: '### Group 3: Quality Locks',
  };
  const found = {};
  for (const [tierKey, heading] of Object.entries(sections)) {
    const start = coreSkillText.indexOf(heading);
    if (start === -1) {
      found[tierKey] = null;
      continue;
    }
    const afterStart = start + heading.length;
    const nextGroup = coreSkillText.indexOf('\n### ', afterStart);
    const nextPart = coreSkillText.indexOf('\n## ', afterStart);
    let end = coreSkillText.length;
    if (nextGroup !== -1) end = Math.min(end, nextGroup);
    if (nextPart !== -1) end = Math.min(end, nextPart);
    const slice = coreSkillText.slice(start, end);
    const ids = new Set();
    for (const match of slice.matchAll(/^####\s+(R-(?:0[1-9]|[12]\d|3\d|40))\b/gm)) {
      ids.add(match[1]);
    }
    found[tierKey] = [...ids].sort();
  }
  return found;
}

function checkRelativeLinks(markdownPath, markdownText, label) {
  const broken = [];
  const dir = path.dirname(markdownPath);
  const withoutCode = markdownText.replace(/```[\s\S]*?```/g, '');
  for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim();
    if (
      !rawTarget ||
      rawTarget.startsWith('http://') ||
      rawTarget.startsWith('https://') ||
      rawTarget.startsWith('mailto:') ||
      rawTarget.startsWith('#')
    ) {
      continue;
    }
    const targetPath = rawTarget.split('#')[0].split(' ')[0];
    if (!targetPath) {
      continue;
    }
    const resolved = path.resolve(dir, targetPath);
    if (!fs.existsSync(resolved)) {
      broken.push(rawTarget);
    }
  }
  if (broken.length > 0) {
    fail(label, `broken relative links: ${broken.join(', ')}`);
  }
  return broken.length === 0;
}

function checkNoEmDash(text, label) {
  if (!text.includes(EM_DASH)) {
    return true;
  }
  const lines = text.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, idx) => {
    if (line.includes(EM_DASH)) {
      hits.push(idx + 1);
    }
  });
  fail(label, `em dash (U+2014) found on line(s): ${hits.join(', ')}`);
  return false;
}

function sameList(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function main() {
  const args = process.argv.slice(2);
  let strict = false;
  let jsonOut = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--strict') {
      strict = true;
    } else if (arg === '--json') {
      jsonOut = true;
    } else if (arg === '--root' && args[i + 1]) {
      repoRoot = resolveRepoRoot(args[i + 1]);
      i += 1;
    } else {
      console.error(`Unknown or incomplete argument: ${arg}`);
      console.error('Usage: validate-agent-library.cjs [--root <repo>] [--strict] [--json]');
      process.exit(2);
    }
  }

  let registry;
  let skillRegistry;
  try {
    registry = readJson('.agents/agents/agents-library.json');
  } catch (err) {
    fail('agents-registry', err.message);
  }

  try {
    skillRegistry = readJson('.agents/skills/skills-library.json');
  } catch (err) {
    fail('skills-registry', err.message);
  }

  if (registry) {
    const requiredTopKeys = [
      'version',
      'updated',
      'canonicalRoot',
      'mirrorRoot',
      'skillsRegistry',
      'namingConvention',
      'rulesSources',
      'coreRules',
      'projectGates',
      'agents',
      'backlog',
      'knownGaps',
    ];
    for (const key of requiredTopKeys) {
      if (!(key in registry)) {
        fail('registry-schema', `missing top-level key: ${key}`);
      }
    }

    for (const src of registry.rulesSources || []) {
      const abs = path.join(repoRoot, src);
      if (fs.existsSync(abs)) {
        pass(`rules-source`, `${src} exists`);
      } else {
        fail(`rules-source`, `${src} is missing`);
      }
    }

    const coreSkillPath = path.join(repoRoot, '.agents/skills/antislop/SKILL.md');
    const coreVersionPath = path.join(repoRoot, '.agents/skills/antislop/VERSION');
    if (fs.existsSync(coreSkillPath) && fs.existsSync(coreVersionPath) && registry.coreRules) {
      const liveVersion = fs.readFileSync(coreVersionPath, 'utf8').trim();
      if (registry.coreRules.version === liveVersion) {
        pass('core-version', `antislop ${liveVersion}`);
      } else {
        fail('core-version', `registry says ${registry.coreRules.version}, antislop/VERSION is ${liveVersion}`);
      }

      const liveTiers = extractAntislopTiers(fs.readFileSync(coreSkillPath, 'utf8'));
      for (const [tier, expectedIds] of Object.entries(registry.coreRules.tiers || {})) {
        const regSorted = [...expectedIds].sort();
        const liveSorted = liveTiers[tier];
        if (!liveSorted) {
          fail(`core-tier:${tier}`, 'tier heading not found in antislop/SKILL.md');
        } else if (sameList(regSorted, liveSorted)) {
          pass(`core-tier`, `${tier}: ${regSorted.length} rules match`);
        } else {
          fail(
            `core-tier:${tier}`,
            `registry [${regSorted.join(',')}] differs from antislop [${liveSorted.join(',')}]`
          );
        }
      }
    }

    const activeSkills = new Map();
    if (skillRegistry && Array.isArray(skillRegistry.skills)) {
      for (const skill of skillRegistry.skills) {
        activeSkills.set(skill.name, skill);
      }
      pass('skills-registry', `loaded ${activeSkills.size} registered skill(s)`);
    }

    const naming = registry.namingConvention || {};
    const nameRegex = new RegExp(naming.pattern || '^[a-z0-9]+(-[a-z0-9]+)*$');
    const requiredSuffix = naming.requiredSuffix || '-agent';
    const exceptions = new Set(naming.allowedExceptions || []);
    const [descMin, descMax] = naming.descriptionLength || [20, 400];
    const maxLines = typeof naming.maxLines === 'number' ? naming.maxLines : 120;

    const agentList = Array.isArray(registry.agents) ? registry.agents : [];
    const agentNames = new Set(agentList.map((a) => a.name));
    const seen = new Set();

    for (const entry of agentList) {
      const tag = `agent:${entry.name}`;
      let ok = true;

      if (seen.has(entry.name)) {
        fail(tag, 'duplicate agent entry');
        continue;
      }
      seen.add(entry.name);

      const requiredFields = [
        'name',
        'path',
        'origin',
        'status',
        'role',
        'description',
        'skills',
        'dependsOnAgents',
        'tools',
        'rules',
        'references',
        'mirror',
      ];
      for (const field of requiredFields) {
        if (!(field in entry)) {
          fail(tag, `missing required field: ${field}`);
          ok = false;
        }
      }

      if (!nameRegex.test(entry.name)) {
        fail(tag, `name does not match ${nameRegex}`);
        ok = false;
      }
      if (!entry.name.endsWith(requiredSuffix) && !exceptions.has(entry.name)) {
        fail(tag, `name must end with "${requiredSuffix}" or be listed in namingConvention.allowedExceptions`);
        ok = false;
      }
      if (activeSkills.has(entry.name)) {
        fail(tag, 'agent name collides with an existing skill in skills-library.json');
        ok = false;
      }

      if (!['repo', 'vendor'].includes(entry.origin)) {
        fail(tag, `invalid origin "${entry.origin}"`);
        ok = false;
      }
      if (!['active', 'deprecated'].includes(entry.status)) {
        fail(tag, `invalid status "${entry.status}"`);
        ok = false;
      }

      const expectedPath = `${registry.canonicalRoot}/${entry.name}.md`;
      if (entry.path !== expectedPath) {
        fail(tag, `expected path "${expectedPath}", found "${entry.path}"`);
        ok = false;
      }

      const absAgentMd = path.join(repoRoot, entry.path || '');
      if (!fs.existsSync(absAgentMd)) {
        fail(tag, `missing agent file at ${entry.path}`);
        continue;
      }

      const rawMd = fs.readFileSync(absAgentMd, 'utf8');
      const front = parseFrontmatter(rawMd);
      if (!front) {
        fail(tag, 'missing or invalid YAML frontmatter');
        ok = false;
      } else {
        if (front.fields.name !== entry.name) {
          fail(tag, `frontmatter name "${front.fields.name}" differs from registry "${entry.name}"`);
          ok = false;
        }
        if (front.fields.description !== entry.description) {
          fail(tag, 'frontmatter description differs from registry description');
          ok = false;
        }
        const descLen = (entry.description || '').length;
        if (descLen < descMin || descLen > descMax) {
          fail(tag, `description length ${descLen} outside [${descMin}, ${descMax}]`);
          ok = false;
        }
        if (Array.isArray(front.fields.skills)) {
          const fmSorted = [...front.fields.skills].sort();
          const regSorted = [...(entry.skills || [])].sort();
          if (!sameList(fmSorted, regSorted)) {
            fail(tag, 'frontmatter skills[] differs from registry skills[]');
            ok = false;
          }
        }
      }

      for (const skillName of entry.skills || []) {
        const skill = activeSkills.get(skillName);
        if (!skill) {
          fail(tag, `unknown skill "${skillName}" in skills[]`);
          ok = false;
        } else if (skill.status !== 'active') {
          warn(tag, `bound skill "${skillName}" has status "${skill.status}"`);
        }
      }

      for (const depAgent of entry.dependsOnAgents || []) {
        if (depAgent === entry.name) {
          fail(tag, 'dependsOnAgents cannot reference self');
          ok = false;
        } else if (!agentNames.has(depAgent)) {
          fail(tag, `unknown dependsOnAgents entry: "${depAgent}"`);
          ok = false;
        }
      }

      for (const rule of entry.rules || []) {
        if (!RULE_ID.test(rule)) {
          fail(tag, `unrecognized rule ID "${rule}" in rules[]`);
          ok = false;
        }
      }

      if (entry.origin === 'repo') {
        if (front && front.lines > maxLines) {
          fail(tag, `${entry.name}.md has ${front.lines} lines (limit ${maxLines})`);
          ok = false;
        }
        if (!checkNoEmDash(rawMd, `${tag}:em-dash`)) {
          ok = false;
        }
        if (!checkRelativeLinks(absAgentMd, rawMd, `${tag}:links`)) {
          ok = false;
        }

        const expectedMirror = `${registry.mirrorRoot}/${entry.name}.md`;
        if (entry.mirror !== expectedMirror) {
          fail(tag, `mirror should be "${expectedMirror}", found "${entry.mirror}"`);
          ok = false;
        } else {
          const absMirror = path.join(repoRoot, expectedMirror);
          if (!fs.existsSync(absMirror)) {
            fail(tag, `missing mirror file at ${expectedMirror}`);
            ok = false;
          } else if (sha256(absAgentMd) !== sha256(absMirror)) {
            fail(tag, `mirror ${expectedMirror} differs from ${entry.path}`);
            ok = false;
          }
        }

        for (const refFile of entry.references || []) {
          const refRel = `${registry.canonicalRoot}/${entry.name}/references/${refFile}`;
          const absRef = path.join(repoRoot, refRel);
          if (!fs.existsSync(absRef)) {
            fail(tag, `missing reference ${refRel}`);
            ok = false;
            continue;
          }
          const refText = fs.readFileSync(absRef, 'utf8');
          if (!checkNoEmDash(refText, `${tag}:${refFile}:em-dash`)) {
            ok = false;
          }
          if (!checkRelativeLinks(absRef, refText, `${tag}:${refFile}:links`)) {
            ok = false;
          }
          const mirrorRefRel = `${registry.mirrorRoot}/${entry.name}/references/${refFile}`;
          const absMirrorRef = path.join(repoRoot, mirrorRefRel);
          if (!fs.existsSync(absMirrorRef)) {
            fail(tag, `missing mirrored reference ${mirrorRefRel}`);
            ok = false;
          } else if (sha256(absRef) !== sha256(absMirrorRef)) {
            fail(tag, `mirrored reference ${mirrorRefRel} differs from ${refRel}`);
            ok = false;
          }
        }
      } else if (entry.mirror !== null) {
        warn(tag, 'vendor agent usually has mirror: null');
      }

      if (ok) {
        pass(tag, 'registered, frontmatter, skill bindings and mirror consistent');
      }
    }

    for (const item of registry.backlog || []) {
      const bTag = `backlog:${item.name}`;
      if (!nameRegex.test(item.name) || (!item.name.endsWith(requiredSuffix) && !exceptions.has(item.name))) {
        fail(bTag, `backlog name must match ${nameRegex} and end with "${requiredSuffix}"`);
      } else if (agentNames.has(item.name)) {
        fail(bTag, 'backlog item already exists in agents[]');
      } else {
        pass(bTag, 'valid planned agent entry');
      }
    }
  }

  const exitCode = fails > 0 || (strict && warns > 0) ? 1 : 0;

  if (jsonOut) {
    console.log(
      JSON.stringify(
        {
          total: results.length,
          passed: results.filter((r) => r.status === 'PASS').length,
          failed: fails,
          warnings: warns,
          exitCode,
          results,
        },
        null,
        2
      )
    );
  } else {
    for (const row of results) {
      console.log(`${row.status} ${row.name}: ${row.detail}`);
    }
    console.log(`\n${results.length} checks, ${fails} failed, ${warns} warnings. Exit ${exitCode}.`);
  }

  process.exit(exitCode);
}

main();

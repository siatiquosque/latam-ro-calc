/**
 * Condenses rAthena's db/re/skill_tree.yml and skill_db.yml into data/skill-tree/rathena-skill-tree.json: for each job the skills it
 * teaches (max level, prerequisites, base/job level to unlock) and the jobs it inherits, with the names the calculator uses.
 * The tree is the kRO one, not confirmed for LATAM: the validator reports against it as a reference, never as a rule.
 *
 *   node tools/build-skill-tree.mjs <skill_tree.yml> <skill_db.yml>
 *   (raw files: https://raw.githubusercontent.com/rathena/rathena/master/db/re/)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const [treePath, dbPath] = process.argv.slice(2);
if (!treePath || !dbPath) throw new Error('uso: node tools/build-skill-tree.mjs <skill_tree.yml> <skill_db.yml>');

const lines = (path) => readFileSync(path, 'utf8').split(/\r?\n/);

// skill_db: aegis name -> calculator-facing name (Description) and max level.
const names = {};
{
  let current;
  for (const line of lines(dbPath)) {
    let match;
    if ((match = line.match(/^  - Id: (\d+)/))) current = { id: Number(match[1]) };
    else if (current && (match = line.match(/^    Name: (\S+)/))) { current.aegis = match[1]; }
    else if (current && (match = line.match(/^    Description: (.+)$/))) { names[current.aegis] = match[1].trim(); }
  }
}

const jobs = {};
{
  let job;
  let skill;
  let section;
  let require;
  for (const line of lines(treePath)) {
    let match;
    if ((match = line.match(/^  - Job: (\S+)/))) { job = jobs[match[1]] = { inherit: [], skills: {} }; skill = undefined; section = undefined; }
    else if (!job) continue;
    else if (/^    Inherit:/.test(line)) section = 'inherit';
    else if (/^    Tree:/.test(line)) section = 'tree';
    else if (section === 'inherit' && (match = line.match(/^      (\S+): true/))) job.inherit.push(match[1]);
    else if (section === 'tree' && (match = line.match(/^      - Name: (\S+)/))) {
      skill = job.skills[match[1]] = { name: names[match[1]] ?? match[1] };
      require = undefined;
    } else if (skill && (match = line.match(/^        MaxLevel: (\d+)/))) skill.max = Number(match[1]);
    else if (skill && (match = line.match(/^        BaseLevel: (\d+)/))) skill.baseLevel = Number(match[1]);
    else if (skill && (match = line.match(/^        JobLevel: (\d+)/))) skill.jobLevel = Number(match[1]);
    else if (skill && /^        Exclude: true/.test(line)) skill.exclude = true;
    else if (skill && /^        Requires:/.test(line)) { skill.requires = []; }
    else if (skill?.requires && (match = line.match(/^          - Name: (\S+)/))) { require = { name: names[match[1]] ?? match[1] }; skill.requires.push(require); }
    else if (require && (match = line.match(/^            Level: (\d+)/))) require.level = Number(match[1]);
  }
}

mkdirSync('data/skill-tree', { recursive: true });
writeFileSync('data/skill-tree/rathena-skill-tree.json', JSON.stringify({
  _readme: 'Gerado por tools/build-skill-tree.mjs a partir de db/re/skill_tree.yml e skill_db.yml do rAthena. Árvore do kRO, não confirmada no LATAM: referência, nunca regra.',
  jobs,
}));
console.log(`${Object.keys(jobs).length} jobs, ${Object.values(jobs).reduce((sum, job) => sum + Object.keys(job.skills).length, 0)} skills`);

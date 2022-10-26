import arg from 'arg';
import inquirer from 'inquirer';
import fsPromise from 'fs/promises';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import Listr from 'listr';

const g2js = require('gradle-to-js/lib/parser');
const execa = require('execa');
const work_dir = process.cwd();
const FILE_NAME = 'build.gradle';

const getProjectModules = async () => {
  const paths = await fsPromise.readdir(work_dir);
  const fileStats = await Promise.all(
    paths.map(async (filePath) => {
      const fsStat = await fsPromise.lstat(path.resolve(work_dir, filePath));
      return { path: filePath, fsStat };
    })
  );
  const dirs = fileStats.filter((dir) => dir.fsStat.isDirectory()).map((dir) => dir.path);

  return dirs
    .map((dir) => {
      const isGradleModule = fs.existsSync(path.resolve(work_dir, dir, FILE_NAME));
      return { dir, isGradleModule };
    })
    .filter((module) => module.isGradleModule)
    .map((dir) => dir.dir);
};

const parseArgumentsIntoOptions = (rawArgs) => {
  const args = arg(
    {
      '--module': String,
      '-m': '--module',
    },
    {
      argv: rawArgs.slice(2),
    }
  );
  return {
    module: args['--module'],
  };
};

const getModuleVersions = async (module) => {
  const representation = await g2js.parseFile(path.resolve(work_dir, module, FILE_NAME));
  const currentVersion = representation.version;

  const getVersion = (splits, index) => {
    const newSplits = [...splits];
    newSplits[index] = parseInt(newSplits[index]) + 1;
    return newSplits.join('.');
  };

  const splits = currentVersion.split('.');
  const patchVersion = getVersion(splits, 2);
  const minorVersion = getVersion(splits, 1);
  const majorVersion = getVersion(splits, 0);

  return { currentVersion, patchVersion, minorVersion, majorVersion };
};

const promptForMissingOptions = async (options) => {
  const modules = await getProjectModules();
  let selectedModule = options.module;

  if (!options.module) {
    const moduleAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'module',
        message: 'Please choose a module to update',
        choices: modules,
        default: modules.length > 0 ? selectedModule : '',
      },
    ]);
    selectedModule = moduleAnswer.module;
  }
  const { currentVersion, patchVersion, minorVersion, majorVersion } = await getModuleVersions(selectedModule);

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'version',
      message: `Select increment (next version), [${chalk.green.bold(currentVersion)}]`,
      choices: [`patch (${patchVersion})`, `minor (${minorVersion})`, `major (${majorVersion})`],
      default: 'patch',
    },
    {
      type: 'confirm',
      name: 'commit',
      message: 'Commit?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'tag',
      message: 'Add tag?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'shouldPush',
      message: 'Push to remote?',
      default: false,
    },
  ]);

  return {
    ...options,
    module: selectedModule,
    version: answers.version.match(/\d*\.\d*\.\d*/g)[0],
    commit: answers.commit,
    tag: answers.tag,
    shouldPush: answers.shouldPush,
  };
};

const writeVersion = async (options) => {
  const filePath = path.join(work_dir, options.module, FILE_NAME);

  try {
    const fileContent = await fsPromise.readFile(filePath, 'utf-8');
    const updatedFileContent = fileContent.replace(/version\s*"\d*\.\d*\.\d*"/g, `version "${options.version}"`);
    await fsPromise.writeFile(filePath, updatedFileContent, 'utf-8');
  } catch (error) {
    throw new Error('Update version failed');
  }
};

const makeCommit = async (options, ctx) => {
  const commitMessage = `release(N/A): upgrade ${options.module} to ${options.version}`;
  const executeOptions = { cwd: work_dir };

  try {
    await execa('git', ['add', '.'], executeOptions);
    await execa('git', ['commit', '-m', commitMessage], executeOptions);
  } catch (error) {
    ctx.isCommitFailed = false;
    throw new Error('Tag and commit failed');
  }
};

const addTag = async (options) => {
  try {
    await execa('git', ['tag', options.version], { cwd: work_dir });
  } catch (error) {
    throw new Error('Tag and commit failed');
  }
};

const pushCode = async (options) => {
  const executeOptions = { cwd: work_dir };

  try {
    await execa('git', ['push', 'origin', options.version], executeOptions);
    await execa('git', ['push'], executeOptions);
  } catch (error) {
    throw new Error('Push failed');
  }
};

const runTasks = async (options) => {
  const tasks = new Listr([
    {
      title: 'Update version',
      task: () => writeVersion(options),
    },
    {
      title: 'Commit',
      task: (ctx) => makeCommit(options, ctx),
      skip: () => (options.commit ? undefined : 'Skip commit'),
    },
    {
      title: 'Add tag',
      task: () => addTag(options),
      skip: (ctx) => (options.tag && !ctx.isCommitFailed ? undefined : 'Skip tag'),
    },
    {
      title: 'Push',
      task: () => pushCode(options),
      skip: (ctx) => {
        const shouldPush = options.shouldPush && !ctx.isCommitFailed && options.commit;
        return shouldPush ? undefined : 'Skip push';
      },
    },
  ]);

  await tasks.run();
  console.log(`\n🎉🎉🎉${chalk.green.bold('DONE')} Successfully!`);
};

export const cli = async (args) => {
  let options = parseArgumentsIntoOptions(args);
  options = await promptForMissingOptions(options);
  await runTasks(options);
};

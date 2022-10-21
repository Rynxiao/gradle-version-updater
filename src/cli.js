import arg from 'arg';
import inquirer from 'inquirer';
import fsPromise from 'fs/promises';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const g2js = require('gradle-to-js/lib/parser');
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

  const versionAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'version',
      message: `Select increment (next version), ${chalk.green.bold(currentVersion)}`,
      choices: [`patch (${patchVersion})`, `minor (${minorVersion})`, `major (${majorVersion})`],
      default: 'patch',
    },
  ]);
  return {
    ...options,
    module: selectedModule,
    version: options.version || versionAnswer.version,
  };
};

export const cli = async (args) => {
  let options = parseArgumentsIntoOptions(args);
  options = await promptForMissingOptions(options);
  console.log(options);
};

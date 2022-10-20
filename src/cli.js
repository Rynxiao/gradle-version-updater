import arg from 'arg';
import inquirer from 'inquirer';
import fsPromise from 'fs/promises';
import fs from 'fs';
import path from 'path';

const work_dir = process.cwd();

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
      const isGradleModule = fs.existsSync(path.resolve(work_dir, dir, 'build.gradle'));
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

const promptForMissingOptions = async (options) => {
  const modules = await getProjectModules();

  const questions = [];
  if (!options.module) {
    questions.push({
      type: 'list',
      name: 'module',
      message: 'Please choose module version to update',
      choices: modules,
      default: modules.length > 0 ? modules[0] : '',
    });
  }

  questions.push({
    type: 'list',
    name: 'version',
    message: 'Select increment (next version)',
    choices: ['patch', 'minor', 'major'],
    default: 'patch',
  });

  const answers = await inquirer.prompt(questions);
  return {
    ...options,
    module: options.module || answers.module,
    version: options.version || answers.version,
  };
};

export const cli = async (args) => {
  let options = parseArgumentsIntoOptions(args);
  options = await promptForMissingOptions(options);
  console.log(options);
};

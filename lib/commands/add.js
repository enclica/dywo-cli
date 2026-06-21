async function add(type, name, options) {
  const path = require('path');
  const fs = require('fs-extra');
  const chalk = require('chalk');

  const projectRoot = process.cwd();
  const validTypes = ['component', 'page', 'route'];

  if (!validTypes.includes(type)) {
    console.error(chalk.red(`Invalid type: ${type}`));
    console.error(chalk.gray(`Valid types: ${validTypes.join(', ')}`));
    process.exit(1);
  }

  if (!name) {
    const inquirer = require('inquirer');
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'name',
      message: `Enter the ${type} name:`,
      validate: v => v.length > 0 || 'Name is required'
    }]);
    name = answers.name;
  }

  // PascalCase the name
  const componentName = name.charAt(0).toUpperCase() + name.slice(1);

  let targetDir;
  if (options.path) {
    targetDir = path.resolve(projectRoot, options.path);
  } else if (type === 'component') {
    targetDir = path.join(projectRoot, 'src', 'components');
  } else if (type === 'page') {
    targetDir = path.join(projectRoot, 'src', 'pages');
  } else {
    targetDir = path.join(projectRoot, 'src');
  }

  await fs.ensureDir(targetDir);

  const filePath = path.join(targetDir, `${componentName}.dywo`);

  if (fs.existsSync(filePath)) {
    console.error(chalk.red(`File already exists: ${path.relative(projectRoot, filePath)}`));
    process.exit(1);
  }

  const template = type === 'page'
    ? generatePageTemplate(componentName)
    : generateComponentTemplate(componentName);

  await fs.writeFile(filePath, template);

  console.log(chalk.green(`\nCreated ${type}: ${path.relative(projectRoot, filePath)}\n`));

  if (type === 'page') {
    console.log(chalk.gray(`Add to your routes in main.dywo:`));
    console.log(chalk.cyan(`  import ${componentName} from '@pages/${componentName}.dywo';`));
    console.log(chalk.cyan(`  // In routes: { path: '/${name.toLowerCase()}', component: ${componentName} }`));
  }
}

function generateComponentTemplate(name) {
  return `<template>
  <div class="${name.toLowerCase()}">
    <h2>{{ title }}</h2>
  </div>
</template>

<style scoped>
.${name.toLowerCase()} {
  /* Component styles */
}
</style>

<script>
export default {
  name: '${name}',
  data() {
    return {
      title: '${name}'
    };
  }
};
</script>
`;
}

function generatePageTemplate(name) {
  return `<template>
  <div class="page-${name.toLowerCase()}">
    <h1>{{ title }}</h1>
    <p>Welcome to the ${name} page.</p>
  </div>
</template>

<style scoped>
.page-${name.toLowerCase()} {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}

h1 {
  color: var(--color-primary, #0070f3);
}
</style>

<script>
export default {
  name: '${name}',
  data() {
    return {
      title: '${name}'
    };
  },
  mounted() {
    document.title = this.title;
  }
};
</script>
`;
}

module.exports = add;

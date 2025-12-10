import CLI from "./src/cli/cli.js";
import { fileURLToPath } from 'url'

const isMainModule = () => {
    try {
        const currentFile = fileURLToPath(import.meta.url);
        console.log(currentFile)
        const executedFile = process.argv[1];
        return currentFile === executedFile;
    } catch (error) {
        console.error(error)
        return import.meta.url === `file://${process.argv[1]}`
    }
}

if (isMainModule()) {
    const cli = new CLI();
    const args = process.argv.slice(2);

    cli.run(args).catch(error => {
        console.error('Fatal error:', error.message);
        process.exit(1)
    })
}
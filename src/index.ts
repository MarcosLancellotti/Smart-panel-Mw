import { LogManager } from './core/LogManager';
import { ConfigManager } from './core/ConfigManager';

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Smart Panel Connector v0.1.0         ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  // Initialize LogManager
  const logger = new LogManager();
  logger.info('Smart Panel Connector started');

  // Initialize ConfigManager
  const configManager = new ConfigManager(logger);
  const config = configManager.load();

  logger.info(`Config loaded from ${configManager['configPath']}`);

  // Check if first run
  if (configManager.isFirstRun()) {
    console.log('⚠️  First run detected!');
    console.log('');
    console.log('Please configure your Smart Panel API credentials:');
    console.log('1. Get your API key from: https://smart-panel.app/settings/api-keys');
    console.log('2. Edit the config file at:');
    console.log(`   ${configManager['configPath']}`);
    console.log('');
    console.log('Configuration template:');
    console.log(JSON.stringify(config, null, 2));
    console.log('');
    logger.warn('API key not configured. Please edit config.json');
    process.exit(0);
  }

  // Display current configuration
  console.log('✓ Configuration loaded');
  console.log(`  API URL: ${config.smartPanel.apiUrl}`);
  console.log(`  Company ID: ${config.smartPanel.companyId}`);
  console.log(`  OBS: ${config.obs?.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`  vMix: ${config.vmix?.enabled ? 'Enabled' : 'Disabled'}`);
  console.log('');

  logger.info('Connector ready');
  console.log('✓ Smart Panel Connector is running');
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');
  console.log(`Logs directory: ${logger.getLogsPath()}`);

  // Keep the process running
  process.on('SIGINT', () => {
    console.log('');
    logger.info('Shutting down...');
    console.log('Goodbye! 👋');
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
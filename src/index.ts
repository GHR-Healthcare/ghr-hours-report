// Export all functions for Azure Functions runtime
import './functions/timerTriggers';
import './functions/httpTriggers';

// Export services for testing
export { clearConnectService } from './services/clearconnect';
export { databaseService } from './services/database';
export { emailService } from './services/email';
export { calculateAllHours, calculateHoursForDate } from './utils/hours-calculator';

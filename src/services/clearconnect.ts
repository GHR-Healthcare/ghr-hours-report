import { parseStringPromise } from 'xml2js';
import { ClearConnectOrder, ClearConnectTemp, ClearConnectUser, DailyHoursByRecruiter } from '../types';

export class ClearConnectService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private sessionKey: string | null = null;

  constructor() {
    this.baseUrl = process.env.CLEARCONNECT_URL || 'https://ctms.contingenttalentmanagement.com/genhc/clearConnect/2_0/index.cfm';
    this.username = process.env.CLEARCONNECT_USERNAME || '';
    this.password = process.env.CLEARCONNECT_PASSWORD || '';
  }

  /**
   * Get Base64 encoded credentials for Basic Auth
   */
  private getBasicAuthHeader(): string {
    const credentials = `${this.username}:${this.password}`;
    const base64 = Buffer.from(credentials).toString('base64');
    return `Basic ${base64}`;
  }

  /**
   * Get session key for Bearer Token auth (optional, can use Basic Auth for all requests)
   */
  async getSessionKey(): Promise<string> {
    if (this.sessionKey) {
      return this.sessionKey;
    }

    const response = await fetch(`${this.baseUrl}?action=getSessionKey`, {
      method: 'GET',
      headers: {
        'Authorization': this.getBasicAuthHeader(),
        'Accept': 'application/xml'
      }
    });

    const xml = await response.text();
    const result = await parseStringPromise(xml, { explicitArray: false });
    
    if (result.response?.sessionKey) {
      this.sessionKey = result.response.sessionKey;
      return this.sessionKey;
    }

    throw new Error('Failed to get session key from ClearConnect');
  }

  /**
   * Make a request to ClearConnect API
   */
  private async makeRequest(action: string, params: Record<string, string> = {}): Promise<any> {
    const queryParams = new URLSearchParams({ action, ...params });
    const url = `${this.baseUrl}?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.getBasicAuthHeader(),
        'Accept': 'application/xml'
      }
    });

    if (!response.ok) {
      throw new Error(`ClearConnect API error: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const result = await parseStringPromise(xml, { 
      explicitArray: false,
      ignoreAttrs: true 
    });

    return result;
  }

  /**
   * Get filled orders for a specific date range
   */
  async getOrders(shiftStart: string, shiftEnd: string, tempRegionIds: number[]): Promise<ClearConnectOrder[]> {
    const result = await this.makeRequest('getOrders', {
      shiftStart: `${shiftStart} 00:00:00`,
      shiftEnd: `${shiftEnd} 12:00:00`,
      tempRegionIdIn: tempRegionIds.join(','),
      status: 'filled'
    });

    if (!result.response?.order) {
      return [];
    }

    // Handle single order vs array of orders
    const orders = Array.isArray(result.response.order) 
      ? result.response.order 
      : [result.response.order];

    return orders.map((o: any) => ({
      orderId: o.orderId || '',
      status: o.status || '',
      shiftStartTime: o.shiftStartTime || '',
      shiftEndTime: o.shiftEndTime || '',
      tempId: o.tempId || '',
      firstName: o.firstName || '',
      lastName: o.lastName || '',
      clientId: o.clientId || '',
      clientName: o.clientName || '',
      regionName: o.regionName || '',
      lessLunchMin: o.lessLunchMin || '30'
    }));
  }

  /**
   * Get temp details by ID
   */
  async getTemp(tempId: string): Promise<ClearConnectTemp | null> {
    const result = await this.makeRequest('getTemps', {
      tempIdIn: tempId
    });

    if (!result.response?.tempRecord) {
      return null;
    }

    const temp = Array.isArray(result.response.tempRecord)
      ? result.response.tempRecord[0]
      : result.response.tempRecord;

    return {
      tempId: temp.tempId || '',
      homeRegion: temp.homeRegion || '',
      firstName: temp.firstName || '',
      lastName: temp.lastName || '',
      staffingSpecialist: temp.staffingSpecialist || '',
      recruiter: temp.recruiter || ''
    };
  }

  /**
   * Get user details by ID
   */
  async getUser(userId: string): Promise<ClearConnectUser | null> {
    const result = await this.makeRequest('getUsers', {
      userIdIn: userId
    });

    if (!result.response?.user) {
      return null;
    }

    const user = Array.isArray(result.response.user)
      ? result.response.user[0]
      : result.response.user;

    return {
      userId: user.userId || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || ''
    };
  }

  /**
   * Calculate hours for a specific date
   * Returns hours aggregated by recruiter (staffingSpecialist) user ID
   */
  async calculateHoursForDate(
    targetDate: string, 
    nextDate: string,
    includedRegions: number[],
    activeRecruiterIds: number[]
  ): Promise<DailyHoursByRecruiter> {
    const hoursByRecruiter: DailyHoursByRecruiter = {};

    // Initialize all active recruiters with 0 hours
    activeRecruiterIds.forEach(id => {
      hoursByRecruiter[id] = 0;
    });

    // Get all filled orders for the date
    const orders = await this.getOrders(targetDate, nextDate, includedRegions);

    // Filter orders that actually start on the target date
    const targetDateOrders = orders.filter(order => {
      const orderDate = order.shiftStartTime.split(' ')[0];
      return orderDate === targetDate;
    });

    console.log(`Found ${targetDateOrders.length} orders for ${targetDate}`);

    // Process each order
    for (const order of targetDateOrders) {
      try {
        // Get temp to find the staffing specialist
        const temp = await this.getTemp(order.tempId);
        if (!temp || !temp.staffingSpecialist) {
          continue;
        }

        const recruiterId = parseInt(temp.staffingSpecialist, 10);
        
        // Only count hours for active recruiters in our config
        if (!activeRecruiterIds.includes(recruiterId)) {
          continue;
        }

        // Calculate hours
        const startTime = new Date(order.shiftStartTime);
        const endTime = new Date(order.shiftEndTime);
        const lunchMinutes = parseInt(order.lessLunchMin, 10) || 30;

        const totalMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
        const workedMinutes = totalMinutes - lunchMinutes;
        const hours = workedMinutes / 60;

        // Add to recruiter's total
        if (!hoursByRecruiter[recruiterId]) {
          hoursByRecruiter[recruiterId] = 0;
        }
        hoursByRecruiter[recruiterId] += hours;

      } catch (error) {
        console.error(`Error processing order ${order.orderId}:`, error);
      }
    }

    // Round all values to 2 decimal places
    Object.keys(hoursByRecruiter).forEach(key => {
      hoursByRecruiter[parseInt(key)] = Math.round(hoursByRecruiter[parseInt(key)] * 100) / 100;
    });

    return hoursByRecruiter;
  }

  /**
   * Get all active users from ClearConnect
   */
  async getActiveUsers(): Promise<ClearConnectUser[]> {
    const result = await this.makeRequest('getActiveUsers', {});

    if (!result.response?.user) {
      return [];
    }

    const users = Array.isArray(result.response.user)
      ? result.response.user
      : [result.response.user];

    return users.map((u: any) => ({
      userId: u.userId || '',
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      email: u.email || ''
    }));
  }
}

export const clearConnectService = new ClearConnectService();
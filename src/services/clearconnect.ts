import { parseStringPromise } from 'xml2js';
import { ClearConnectOrder, ClearConnectTemp, ClearConnectUser, DailyHoursByRecruiter } from '../types';

export class ClearConnectService {
  private baseUrl: string;
  private username: string;
  private password: string;

  constructor() {
    this.baseUrl = process.env.CLEARCONNECT_URL || '';
    this.username = process.env.CLEARCONNECT_USERNAME || '';
    this.password = process.env.CLEARCONNECT_PASSWORD || '';
  }

  private getBasicAuthHeader(): string {
    const credentials = `${this.username}:${this.password}`;
    const base64 = Buffer.from(credentials, 'utf-8').toString('base64');
    return `Basic ${base64}`;
  }

  private async makeRequest(action: string, params: Record<string, string> = {}): Promise<any> {
    const queryParams = new URLSearchParams({ action, ...params });
    const url = `${this.baseUrl}?${queryParams.toString()}`;

    console.log(`ClearConnect API: ${action}`, JSON.stringify(params));

    const authHeader = this.getBasicAuthHeader();
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/xml'
      }
    });

    const xml = await response.text();
    
    console.log(`Response status: ${response.status}, length: ${xml.length}`);

    if (!response.ok) {
      throw new Error(`ClearConnect API error: ${response.status} ${response.statusText}`);
    }

    const result = await parseStringPromise(xml, { 
      explicitArray: false,
      ignoreAttrs: true,
      trim: true,
      explicitRoot: false
    });

    return result;
  }

  async getOrders(shiftStart: string, shiftEnd: string): Promise<ClearConnectOrder[]> {
    const result = await this.makeRequest('getOrders', {
      shiftStart: `${shiftStart} 00:00:00`,
      shiftEnd: `${shiftEnd} 23:59:59`,
      status: 'filled'
    });

    // The response structure is: { order: [...] } (root element "orders" is stripped by explicitRoot: false)
    console.log('getOrders result keys:', Object.keys(result || {}));

    if (!result?.order) {
      console.log('No orders found in response');
      return [];
    }

    const orders = Array.isArray(result.order) 
      ? result.order 
      : [result.order];

    console.log(`Parsed ${orders.length} orders`);

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
      lessLunchMin: o.lessLunchMin || '0'
    }));
  }

  async getTemp(tempId: string): Promise<ClearConnectTemp | null> {
    const result = await this.makeRequest('getTemps', {
      tempIdIn: tempId
    });

    // Response structure: { tempRecord: {...} } or { tempRecord: [...] }
    if (!result?.tempRecord) {
      return null;
    }

    const temp = Array.isArray(result.tempRecord)
      ? result.tempRecord[0]
      : result.tempRecord;

    return {
      tempId: temp.tempId || '',
      homeRegion: temp.homeRegion || '',
      firstName: temp.firstName || '',
      lastName: temp.lastName || '',
      staffingSpecialist: temp.staffingSpecialist || '',
      recruiter: temp.recruiter || ''
    };
  }

  async getUser(userId: string): Promise<ClearConnectUser | null> {
    const result = await this.makeRequest('getUsers', {
      userIdIn: userId
    });

    // Response structure: { user: {...} } or { user: [...] }
    if (!result?.user) {
      return null;
    }

    const user = Array.isArray(result.user)
      ? result.user[0]
      : result.user;

    return {
      userId: user.userId || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || ''
    };
  }

  async calculateHoursForDate(targetDate: string, nextDate: string): Promise<DailyHoursByRecruiter> {
    const hoursByRecruiter: DailyHoursByRecruiter = {};

    const orders = await this.getOrders(targetDate, nextDate);

    // Filter orders to only those starting on targetDate
    const targetDateOrders = orders.filter(order => {
      // Handle both formats: "2026-01-14T08:00:00" and "2026-01-14 08:00:00"
      const orderDate = order.shiftStartTime.split('T')[0].split(' ')[0];
      return orderDate === targetDate;
    });

    console.log(`Found ${targetDateOrders.length} orders for ${targetDate}`);

    for (const order of targetDateOrders) {
      try {
        const temp = await this.getTemp(order.tempId);
        if (!temp || !temp.staffingSpecialist) {
          continue;
        }

        const recruiterId = parseInt(temp.staffingSpecialist, 10);

        // Parse ISO format dates
        const startTime = new Date(order.shiftStartTime);
        const endTime = new Date(order.shiftEndTime);
        const lunchMinutes = parseInt(order.lessLunchMin, 10) || 0;

        const totalMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
        const workedMinutes = totalMinutes - lunchMinutes;
        const hours = workedMinutes / 60;

        if (!hoursByRecruiter[recruiterId]) {
          hoursByRecruiter[recruiterId] = 0;
        }
        hoursByRecruiter[recruiterId] += hours;

      } catch (error) {
        console.error(`Error processing order ${order.orderId}:`, error);
      }
    }

    Object.keys(hoursByRecruiter).forEach(key => {
      const numKey = parseInt(key);
      hoursByRecruiter[numKey] = Math.round(hoursByRecruiter[numKey] * 100) / 100;
    });

    return hoursByRecruiter;
  }

  async getActiveUsers(): Promise<ClearConnectUser[]> {
    const result = await this.makeRequest('getActiveUsers', {});

    if (!result?.user) {
      return [];
    }

    const users = Array.isArray(result.user)
      ? result.user
      : [result.user];

    return users.map((u: any) => ({
      userId: u.userId || '',
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      email: u.email || ''
    }));
  }

  // Debug method to test the API
  async testConnection(): Promise<{
    success: boolean;
    baseUrl: string;
    username: string;
    passwordLength: number;
    authHeader: string;
    response?: any;
    error?: string;
  }> {
    const authHeader = this.getBasicAuthHeader();
    
    try {
      // Try a simple API call
      const params = new URLSearchParams({ 
        action: 'getOrders',
        shiftStart: '2026-01-14 00:00:00',
        shiftEnd: '2026-01-14 23:59:59',
        status: 'filled'
      });
      const url = `${this.baseUrl}?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/xml'
        }
      });
      
      const text = await response.text();
      
      return {
        success: response.ok,
        baseUrl: this.baseUrl,
        username: this.username,
        passwordLength: this.password.length,
        authHeader: authHeader.substring(0, 20) + '...',
        response: {
          status: response.status,
          statusText: response.statusText,
          bodyPreview: text.substring(0, 1000),
          bodyLength: text.length
        }
      };
    } catch (error) {
      return {
        success: false,
        baseUrl: this.baseUrl,
        username: this.username,
        passwordLength: this.password.length,
        authHeader: authHeader.substring(0, 20) + '...',
        error: String(error)
      };
    }
  }
}

export const clearConnectService = new ClearConnectService();

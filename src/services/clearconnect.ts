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
    
    console.log(`Response status: ${response.status}`);
    console.log(`Response preview: ${xml.substring(0, 300)}`);

    if (!response.ok) {
      throw new Error(`ClearConnect API error: ${response.status} ${response.statusText} - ${xml.substring(0, 200)}`);
    }

    const result = await parseStringPromise(xml, { 
      explicitArray: false,
      ignoreAttrs: true 
    });

    return result;
  }

  async getOrders(shiftStart: string, shiftEnd: string): Promise<ClearConnectOrder[]> {
    const result = await this.makeRequest('getOrders', {
      shiftStart: `${shiftStart} 00:00:00`,
      shiftEnd: `${shiftEnd} 23:59:59`,
      status: 'filled'
    });

    console.log('getOrders response structure:', JSON.stringify(result).substring(0, 500));

    if (!result.response?.order) {
      console.log('No orders found in response. Full response:', JSON.stringify(result));
      return [];
    }

    const orders = Array.isArray(result.response.order) 
      ? result.response.order 
      : [result.response.order];

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
      lessLunchMin: o.lessLunchMin || '30'
    }));
  }

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

  async calculateHoursForDate(targetDate: string, nextDate: string): Promise<DailyHoursByRecruiter> {
    const hoursByRecruiter: DailyHoursByRecruiter = {};

    const orders = await this.getOrders(targetDate, nextDate);

    const targetDateOrders = orders.filter(order => {
      const orderDate = order.shiftStartTime.split(' ')[0];
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

        const startTime = new Date(order.shiftStartTime);
        const endTime = new Date(order.shiftEndTime);
        const lunchMinutes = parseInt(order.lessLunchMin, 10) || 30;

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

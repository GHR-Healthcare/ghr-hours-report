import { parseStringPromise } from 'xml2js';
import { ClearConnectOrder, ClearConnectTemp, ClearConnectUser, DailyHoursByRecruiter } from '../types';

export class ClearConnectService {
  private baseUrl: string;
  private username: string;
  private password: string;
  
  // Cache for temp lookups (tempId -> temp data)
  private tempCache: Map<string, ClearConnectTemp | null> = new Map();
  // Cache for user lookups (userId -> user data)
  private userCache: Map<string, ClearConnectUser | null> = new Map();

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

  async getOrders(shiftStart: string, shiftEnd: string, regionIds?: string): Promise<ClearConnectOrder[]> {
    const params: Record<string, string> = {
      shiftStart: `${shiftStart} 00:00:00`,
      shiftEnd: `${shiftEnd} 23:59:59`,
      status: 'filled'
    };
    
    // Add region filter if provided
    if (regionIds) {
      params.tempRegionIdIn = regionIds;
    }
    
    const result = await this.makeRequest('getOrders', params);

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
    // Check cache first
    if (this.tempCache.has(tempId)) {
      return this.tempCache.get(tempId) || null;
    }

    const result = await this.makeRequest('getTemps', {
      tempIdIn: tempId
    });

    if (!result?.tempRecord) {
      this.tempCache.set(tempId, null);
      return null;
    }

    const temp = Array.isArray(result.tempRecord)
      ? result.tempRecord[0]
      : result.tempRecord;

    const tempData: ClearConnectTemp = {
      tempId: temp.tempId || '',
      homeRegion: temp.homeRegion || '',
      firstName: temp.firstName || '',
      lastName: temp.lastName || '',
      staffingSpecialist: temp.staffingSpecialist || '',
      recruiter: temp.recruiter || ''
    };

    this.tempCache.set(tempId, tempData);
    return tempData;
  }

  // Batch lookup temps - much faster for multiple temps
  async getTempsBatch(tempIds: string[]): Promise<Map<string, ClearConnectTemp>> {
    const results = new Map<string, ClearConnectTemp>();
    const uncachedIds: string[] = [];

    // Check cache first
    for (const tempId of tempIds) {
      if (this.tempCache.has(tempId)) {
        const cached = this.tempCache.get(tempId);
        if (cached) results.set(tempId, cached);
      } else {
        uncachedIds.push(tempId);
      }
    }

    if (uncachedIds.length === 0) {
      return results;
    }

    // Batch lookup uncached temps (API supports comma-separated IDs)
    // Process in chunks of 100 to avoid URL length limits
    const chunkSize = 100;
    for (let i = 0; i < uncachedIds.length; i += chunkSize) {
      const chunk = uncachedIds.slice(i, i + chunkSize);
      
      try {
        const result = await this.makeRequest('getTemps', {
          tempIdIn: chunk.join(',')
        });

        if (result?.tempRecord) {
          const temps = Array.isArray(result.tempRecord) 
            ? result.tempRecord 
            : [result.tempRecord];

          for (const temp of temps) {
            const tempData: ClearConnectTemp = {
              tempId: temp.tempId || '',
              homeRegion: temp.homeRegion || '',
              firstName: temp.firstName || '',
              lastName: temp.lastName || '',
              staffingSpecialist: temp.staffingSpecialist || '',
              recruiter: temp.recruiter || ''
            };
            this.tempCache.set(tempData.tempId, tempData);
            results.set(tempData.tempId, tempData);
          }
        }
      } catch (error) {
        console.error(`Error fetching temp batch:`, error);
      }
    }

    // Mark unfound temps as null in cache
    for (const tempId of uncachedIds) {
      if (!results.has(tempId)) {
        this.tempCache.set(tempId, null);
      }
    }

    return results;
  }

  async getUser(userId: string): Promise<ClearConnectUser | null> {
    // Check cache first
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId) || null;
    }

    const result = await this.makeRequest('getUsers', {
      userIdIn: userId
    });

    if (!result?.user) {
      this.userCache.set(userId, null);
      return null;
    }

    const user = Array.isArray(result.user)
      ? result.user[0]
      : result.user;

    const userData: ClearConnectUser = {
      userId: user.userId || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || ''
    };

    this.userCache.set(userId, userData);
    return userData;
  }

  // Batch lookup users
  async getUsersBatch(userIds: string[]): Promise<Map<string, ClearConnectUser>> {
    const results = new Map<string, ClearConnectUser>();
    const uncachedIds: string[] = [];

    // Check cache first
    for (const userId of userIds) {
      if (this.userCache.has(userId)) {
        const cached = this.userCache.get(userId);
        if (cached) results.set(userId, cached);
      } else {
        uncachedIds.push(userId);
      }
    }

    if (uncachedIds.length === 0) {
      return results;
    }

    // Batch lookup in chunks
    const chunkSize = 100;
    for (let i = 0; i < uncachedIds.length; i += chunkSize) {
      const chunk = uncachedIds.slice(i, i + chunkSize);
      
      try {
        const result = await this.makeRequest('getUsers', {
          userIdIn: chunk.join(',')
        });

        if (result?.user) {
          const users = Array.isArray(result.user) 
            ? result.user 
            : [result.user];

          for (const user of users) {
            const userData: ClearConnectUser = {
              userId: user.userId || '',
              firstName: user.firstName || '',
              lastName: user.lastName || '',
              email: user.email || ''
            };
            this.userCache.set(userData.userId, userData);
            results.set(userData.userId, userData);
          }
        }
      } catch (error) {
        console.error(`Error fetching user batch:`, error);
      }
    }

    return results;
  }

  async calculateWeeklyHours(weekStart: string, weekEnd: string): Promise<DailyHoursByRecruiter> {
    const hoursByRecruiter: DailyHoursByRecruiter = {};

    // Fetch day by day to avoid API pagination limits
    const startDate = new Date(weekStart);
    const endDate = new Date(weekEnd);
    let allOrders: ClearConnectOrder[] = [];
    
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const nextDate = new Date(currentDate);
      nextDate.setDate(nextDate.getDate() + 1);
      const nextDateStr = nextDate.toISOString().split('T')[0];
      
      console.log(`Fetching orders for ${dateStr}...`);
      const dayOrders = await this.getOrders(dateStr, dateStr);
      
      // Filter to only orders starting on this date
      const filteredOrders = dayOrders.filter(order => {
        const orderDate = order.shiftStartTime.split('T')[0].split(' ')[0];
        return orderDate === dateStr;
      });
      
      allOrders = allOrders.concat(filteredOrders);
      console.log(`Got ${filteredOrders.length} orders for ${dateStr}`);
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`Total orders for week ${weekStart} to ${weekEnd}: ${allOrders.length}`);

    // Get all unique temp IDs
    const tempIds = [...new Set(allOrders.map(o => o.tempId).filter(id => id))];
    console.log(`Looking up ${tempIds.length} unique temps...`);

    // Batch fetch all temps at once
    const tempsMap = await this.getTempsBatch(tempIds);
    console.log(`Retrieved ${tempsMap.size} temps`);

    // Process orders using cached temp data
    for (const order of allOrders) {
      try {
        const temp = tempsMap.get(order.tempId);
        if (!temp || !temp.staffingSpecialist) {
          continue;
        }

        const recruiterId = parseInt(temp.staffingSpecialist, 10);

        const startTime = new Date(order.shiftStartTime);
        const endTime = new Date(order.shiftEndTime);

        // Give credit for full shift time (no lunch deduction)
        const totalMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
        const hours = totalMinutes / 60;

        if (!hoursByRecruiter[recruiterId]) {
          hoursByRecruiter[recruiterId] = 0;
        }
        hoursByRecruiter[recruiterId] += hours;

      } catch (error) {
        console.error(`Error processing order ${order.orderId}:`, error);
      }
    }

    // Round to 2 decimal places
    Object.keys(hoursByRecruiter).forEach(key => {
      const numKey = parseInt(key);
      hoursByRecruiter[numKey] = Math.round(hoursByRecruiter[numKey] * 100) / 100;
    });

    return hoursByRecruiter;
  }

  async calculateHoursForDate(targetDate: string, nextDate: string): Promise<DailyHoursByRecruiter> {
    const hoursByRecruiter: DailyHoursByRecruiter = {};

    const allOrders = await this.getOrders(targetDate, nextDate);

    // Filter orders to only those starting on targetDate AND in Nursing/Acute/Temp to Perm regions
    const targetDateOrders = allOrders.filter(order => {
      const orderDate = order.shiftStartTime.split('T')[0].split(' ')[0];
      if (orderDate !== targetDate) return false;
      
      // Region filter - only include Nursing, Acute, or Temp to Perm
      const regionName = (order.regionName || '').toLowerCase();
      return regionName.includes('nursing') || regionName.includes('acute') || regionName.includes('temp to perm');
    });

    console.log(`Found ${targetDateOrders.length} filtered orders for ${targetDate} (from ${allOrders.length} total)`);

    // Get all unique temp IDs
    const tempIds = [...new Set(targetDateOrders.map(o => o.tempId).filter(id => id))];
    console.log(`Looking up ${tempIds.length} unique temps...`);

    // Batch fetch all temps at once
    const tempsMap = await this.getTempsBatch(tempIds);
    console.log(`Retrieved ${tempsMap.size} temps`);

    // Process orders using cached temp data
    for (const order of targetDateOrders) {
      try {
        const temp = tempsMap.get(order.tempId);
        if (!temp || !temp.staffingSpecialist) {
          continue;
        }

        const recruiterId = parseInt(temp.staffingSpecialist, 10);

        const startTime = new Date(order.shiftStartTime);
        const endTime = new Date(order.shiftEndTime);

        // Give credit for full shift time (no lunch deduction)
        const totalMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
        const hours = totalMinutes / 60;

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

  // Clear caches (useful for long-running processes)
  clearCaches(): void {
    this.tempCache.clear();
    this.userCache.clear();
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

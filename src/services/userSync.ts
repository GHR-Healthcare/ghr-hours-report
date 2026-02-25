import { databaseService } from './database';
import {
  AtsSystem,
  PlacementData,
  RecruiterRole,
} from '../types';

export interface SyncStats {
  newUsers: number;
  mergedUsers: number;
  titlesSet: number;
  emailsSet: number;
  rolesSet: number;
  divisionsSet: number;
  deactivated: number;
}

class UserSyncService {
  private unassignedDivisionId: number | null = null;

  /**
   * Infer role from a title string.
   * - Recruiter: title contains recruiter, recruiting, talent acquisition, sourcer
   * - Account Manager: title contains staffing specialist, account manager, account executive, sales, business development, client manager
   */
  inferRole(title: string | null): RecruiterRole {
    if (!title) return 'unknown';
    const t = title.toLowerCase();
    if (
      t.includes('recruiter') ||
      t.includes('recruiting') ||
      t.includes('talent acquisition') ||
      t.includes('sourcer')
    ) {
      return 'recruiter';
    }
    if (
      t.includes('staffing specialist') ||
      t.includes('account manager') ||
      t.includes('account executive') ||
      t.includes('sales') ||
      t.includes('business development') ||
      t.includes('client manager')
    ) {
      return 'account_manager';
    }
    return 'unknown';
  }

  /**
   * Get or create the "Unassigned" division, used as default when division can't be detected.
   */
  private async getUnassignedDivisionId(): Promise<number> {
    if (this.unassignedDivisionId) return this.unassignedDivisionId;

    let divId = await databaseService.findDivisionByName('Unassigned');
    if (!divId) {
      const div = await databaseService.createDivision({ division_name: 'Unassigned', display_order: 999 });
      divId = div.division_id;
    }
    this.unassignedDivisionId = divId;
    return divId;
  }

  /**
   * Detect division for a user based on ATS system.
   * Bullhorn: department lookup. Symplr: email domain. Falls back to Unassigned.
   */
  private async detectDivision(
    atsSystem: AtsSystem,
    atsUserId: number,
    email: string | null,
  ): Promise<number> {
    const unassignedId = await this.getUnassignedDivisionId();

    if (atsSystem === 'bullhorn') {
      const deptName = await databaseService.getUserDepartmentFromBullhorn(atsUserId);
      if (deptName) {
        const divId = await databaseService.findDivisionByName(deptName)
          || await databaseService.findDivisionByNamePartial(deptName);
        if (divId) return divId;
      }
      return unassignedId;
    }

    // Symplr: infer from email domain
    if (email) {
      const lowerEmail = email.toLowerCase();
      if (lowerEmail.includes('@ghreducation.com')) {
        const divId = await databaseService.findDivisionByName('Education')
          || await databaseService.findDivisionByNamePartial('Education');
        if (divId) return divId;
      } else if (lowerEmail.includes('@ghrhealthcare.com')) {
        const divId = await databaseService.findDivisionByName('Non-Acute Nursing');
        if (divId) return divId;
      }
    }

    return unassignedId;
  }

  /**
   * Centralized user sync. Discovers new users from both ATS systems,
   * refreshes metadata for existing users with unset fields.
   * Called from the nightly cleanup timer — single source of truth.
   */
  async syncAllUsers(): Promise<SyncStats> {
    const stats: SyncStats = { newUsers: 0, mergedUsers: 0, titlesSet: 0, emailsSet: 0, rolesSet: 0, divisionsSet: 0, deactivated: 0 };

    // 1. Merge duplicate configs (same person in both ATS systems, matched by email)
    await this.mergeExistingDuplicates(stats);

    // 2. Sync divisions from ATS + ensure Unassigned exists
    const newDivs = await databaseService.syncDivisionsFromAts();
    if (newDivs > 0) console.log(`User sync: created ${newDivs} new divisions from ATS`);
    await this.getUnassignedDivisionId();

    // 3. Discover new users from both ATS systems (90-day lookback)
    const now = new Date();
    const syncEnd = now.toISOString().split('T')[0];
    const syncStart = new Date(now);
    syncStart.setDate(syncStart.getDate() - 90);
    const syncStartStr = syncStart.toISOString().split('T')[0];

    const checkedAtsIds = new Set<string>();

    const symplrData = await databaseService.getSymplrPlacementData(syncStartStr, syncEnd);
    await this.discoverNewUsers(symplrData, 'symplr', checkedAtsIds, stats);

    let bullhornData: PlacementData[] = [];
    try {
      bullhornData = await databaseService.getBullhornPlacementData(syncStartStr, syncEnd);
      await this.discoverNewUsers(bullhornData, 'bullhorn', checkedAtsIds, stats);
    } catch (err) {
      console.error('User sync: Bullhorn query failed, skipping:', err);
    }

    console.log(`User sync: checked ${symplrData.length} Symplr + ${bullhornData.length} Bullhorn placement records, added ${stats.newUsers} new users`);

    // 4. Refresh existing users with unset fields (per-field checks)
    await this.refreshExistingUsers(stats);

    // 5. Deactivate users who are inactive in their ATS
    await this.deactivateInactiveUsers(stats);

    console.log(`User sync complete: ${stats.newUsers} new, ${stats.mergedUsers} merged, ${stats.emailsSet} emails set, ${stats.titlesSet} titles set, ${stats.rolesSet} roles set, ${stats.divisionsSet} divisions set, ${stats.deactivated} deactivated`);
    return stats;
  }

  /**
   * Find and merge duplicate user_config entries where the same person
   * exists in both ATS systems (matched by email). The older entry (lower config_id)
   * is kept as the primary; the newer duplicate is deactivated after its ATS ID
   * is linked to the primary.
   */
  private async mergeExistingDuplicates(stats: SyncStats): Promise<void> {
    const allConfigs = await databaseService.getUserConfigs(true);

    // Group configs by lowercase email
    const byEmail = new Map<string, typeof allConfigs>();
    for (const config of allConfigs) {
      if (!config.email) continue;
      const key = config.email.toLowerCase();
      const group = byEmail.get(key);
      if (group) {
        group.push(config);
      } else {
        byEmail.set(key, [config]);
      }
    }

    for (const [email, group] of byEmail) {
      if (group.length < 2) continue;

      // Sort by config_id ascending — keep the first (oldest) as primary
      group.sort((a, b) => a.config_id - b.config_id);
      const primary = group[0];

      for (let i = 1; i < group.length; i++) {
        const duplicate = group[i];

        // Link any ATS IDs from the duplicate to the primary
        const updates: { config_id: number; symplr_user_id?: number; bullhorn_user_id?: number } = {
          config_id: primary.config_id,
        };

        if (!primary.symplr_user_id && duplicate.symplr_user_id) {
          updates.symplr_user_id = duplicate.symplr_user_id;
        }
        if (!primary.bullhorn_user_id && duplicate.bullhorn_user_id) {
          updates.bullhorn_user_id = duplicate.bullhorn_user_id;
        }

        if (updates.symplr_user_id || updates.bullhorn_user_id) {
          await databaseService.updateUserConfig(updates);
        }

        // Deactivate the duplicate
        await databaseService.updateUserConfig({
          config_id: duplicate.config_id,
          is_active: false,
        });

        stats.mergedUsers++;
        console.log(`User sync: merged duplicate ${duplicate.user_name} (config ${duplicate.config_id}) into primary (config ${primary.config_id}) via email ${email}`);
      }
    }
  }

  /**
   * Discover and add new users from ATS placement data.
   */
  private async discoverNewUsers(
    placementData: PlacementData[],
    atsSystem: AtsSystem,
    checkedAtsIds: Set<string>,
    stats: SyncStats,
  ): Promise<void> {
    const nonAcuteNursingId = await databaseService.findDivisionByName('Non-Acute Nursing');

    for (const d of placementData) {
      const key = `${atsSystem}:${d.recruiter_user_id}`;
      if (checkedAtsIds.has(key)) continue;

      const exists = await databaseService.userConfigExistsByAtsId(atsSystem, d.recruiter_user_id);
      if (exists) {
        checkedAtsIds.add(key);
        continue;
      }

      try {
        // Fetch metadata from appropriate ATS
        let title: string | null = null;
        let email: string | null = null;
        let userName = d.recruiter_name || `User ${d.recruiter_user_id}`;

        if (atsSystem === 'bullhorn') {
          title = await databaseService.getUserTitleFromBullhorn(d.recruiter_user_id);
          email = await databaseService.getUserEmailFromBullhorn(d.recruiter_user_id);
        } else {
          title = await databaseService.getUserTitleFromCtmsync(d.recruiter_user_id);
          email = await databaseService.getUserEmailFromCtmsync(d.recruiter_user_id);
          const name = await databaseService.getUserNameFromCtmsync(d.recruiter_user_id);
          if (name) userName = name;
        }

        // Check if this person already exists in the other ATS system (match by email)
        if (email) {
          const existingConfig = await databaseService.findUserConfigByEmail(email);
          if (existingConfig) {
            // Same person in both systems — link the new ATS ID to the existing config
            const atsIdField = atsSystem === 'symplr' ? 'symplr_user_id' : 'bullhorn_user_id';
            const alreadyLinked = atsSystem === 'symplr'
              ? existingConfig.symplr_user_id != null
              : existingConfig.bullhorn_user_id != null;

            if (!alreadyLinked) {
              await databaseService.updateUserConfig({
                config_id: existingConfig.config_id,
                [atsIdField]: d.recruiter_user_id,
              });
              console.log(`User sync: linked ${atsSystem} ID ${d.recruiter_user_id} to existing user ${existingConfig.user_name} (config ${existingConfig.config_id}) via email ${email}`);
            }

            checkedAtsIds.add(key);
            continue;
          }
        }

        const role = this.inferRole(title);
        const divisionId = await this.detectDivision(atsSystem, d.recruiter_user_id, email);

        // Default flags: on_stack_ranking always true; on_hours_report true if Non-Acute Nursing
        const onHoursReport = nonAcuteNursingId ? divisionId === nonAcuteNursingId : false;

        await databaseService.createUserConfig({
          user_id: d.recruiter_user_id,
          user_name: userName,
          division_id: divisionId,
          role,
          title: title || undefined,
          email: email || undefined,
          ats_source: atsSystem,
          symplr_user_id: atsSystem === 'symplr' ? d.recruiter_user_id : undefined,
          bullhorn_user_id: atsSystem === 'bullhorn' ? d.recruiter_user_id : undefined,
          on_stack_ranking: true,
          on_hours_report: onHoursReport,
        });

        checkedAtsIds.add(key);
        stats.newUsers++;
        console.log(`User sync: added ${atsSystem} user ${userName} (ID: ${d.recruiter_user_id}, title: ${title}, role: ${role}, division: ${divisionId}, hours: ${onHoursReport})`);
      } catch (err) {
        console.error(`User sync: error adding ${atsSystem} user ${d.recruiter_user_id}:`, err);
      }
    }
  }

  /**
   * Refresh existing users with unset fields. Per-field checks:
   * - email IS NULL → fetch from ATS
   * - title IS NULL → fetch from ATS
   * - role = 'unknown' → infer from title
   * - division = Unassigned → try to detect from ATS/email
   * Fields with real values are never overwritten.
   */
  private async refreshExistingUsers(stats: SyncStats): Promise<void> {
    const allConfigs = await databaseService.getUserConfigs(true);
    const unassignedId = await this.getUnassignedDivisionId();

    for (const config of allConfigs) {
      const needsEmail = !config.email;
      const needsTitle = !config.title;
      const needsRole = config.role === 'unknown';
      // Re-sync division for Bullhorn-only users (Bullhorn dept is authoritative),
      // Symplr-only users (email domain is authoritative), or Unassigned users.
      const isBullhornOnly = config.bullhorn_user_id != null && config.symplr_user_id == null;
      const isSymplrOnly = config.symplr_user_id != null && config.bullhorn_user_id == null;
      const needsDivision = config.division_id === unassignedId || isBullhornOnly || isSymplrOnly;

      if (!needsEmail && !needsTitle && !needsRole && !needsDivision) continue;

      try {
        const updates: { config_id: number; email?: string; title?: string; role?: RecruiterRole; division_id?: number } = {
          config_id: config.config_id,
        };

        // Fetch email if missing
        let email = config.email;
        if (needsEmail) {
          if (config.symplr_user_id) {
            email = await databaseService.getUserEmailFromCtmsync(config.symplr_user_id);
          } else if (config.bullhorn_user_id) {
            email = await databaseService.getUserEmailFromBullhorn(config.bullhorn_user_id);
          }
          if (email) {
            updates.email = email;
            stats.emailsSet++;
          }
        }

        // Fetch title if missing
        let title = config.title;
        if (needsTitle) {
          if (config.symplr_user_id) {
            title = await databaseService.getUserTitleFromCtmsync(config.symplr_user_id);
          } else if (config.bullhorn_user_id) {
            title = await databaseService.getUserTitleFromBullhorn(config.bullhorn_user_id);
          }
          if (title) {
            updates.title = title;
            stats.titlesSet++;
          }
        }

        // Infer role if unknown (use freshly fetched title if available)
        if (needsRole && title) {
          const role = this.inferRole(title);
          if (role !== 'unknown') {
            updates.role = role;
            stats.rolesSet++;
          }
        }

        // Re-detect division (use freshly fetched email if available)
        if (needsDivision) {
          const atsSystem: AtsSystem = config.bullhorn_user_id ? 'bullhorn' : 'symplr';
          const atsUserId = config.bullhorn_user_id || config.symplr_user_id;
          const divEmail = email || (
            config.symplr_user_id
              ? await databaseService.getUserEmailFromCtmsync(config.symplr_user_id)
              : config.bullhorn_user_id
                ? await databaseService.getUserEmailFromBullhorn(config.bullhorn_user_id)
                : null
          );

          if (atsUserId) {
            const divisionId = await this.detectDivision(atsSystem, atsUserId, divEmail);
            // Bullhorn-only: accept any result including Unassigned (better than wrong default)
            // Symplr/manual: only update if we found a real division (not Unassigned)
            const shouldUpdate = divisionId !== config.division_id &&
              (divisionId !== unassignedId || isBullhornOnly);
            if (shouldUpdate) {
              updates.division_id = divisionId;
              stats.divisionsSet++;
            }
          }
        }

        // Apply if anything changed
        if (updates.email || updates.title || updates.role || updates.division_id) {
          await databaseService.updateUserConfig(updates);
          console.log(`User sync: refreshed ${config.user_name}: email="${updates.email}", title="${updates.title}", role=${updates.role}, division=${updates.division_id}`);
        }
      } catch (err) {
        console.warn(`User sync: failed to refresh user ${config.config_id} (${config.user_name}):`, err);
      }
    }
  }
  /**
   * Deactivate users who are inactive/suspended in their ATS.
   * For dual-ATS users, both must be inactive to deactivate.
   */
  private async deactivateInactiveUsers(stats: SyncStats): Promise<void> {
    const allConfigs = await databaseService.getUserConfigs(false); // only active users

    for (const config of allConfigs) {
      if (!config.symplr_user_id && !config.bullhorn_user_id) continue; // manual user, skip

      try {
        let symplrActive = true;
        let bullhornActive = true;

        if (config.symplr_user_id) {
          symplrActive = await databaseService.isSymplrUserActive(config.symplr_user_id);
        }
        if (config.bullhorn_user_id) {
          bullhornActive = await databaseService.isBullhornUserActive(config.bullhorn_user_id);
        }

        // For dual-ATS users, only deactivate if inactive in both systems
        const shouldDeactivate = config.symplr_user_id && config.bullhorn_user_id
          ? !symplrActive && !bullhornActive
          : !symplrActive || !bullhornActive;

        if (shouldDeactivate) {
          await databaseService.updateUserConfig({
            config_id: config.config_id,
            is_active: false,
          });
          stats.deactivated++;
          console.log(`User sync: deactivated ${config.user_name} (config ${config.config_id}) — Symplr active: ${symplrActive}, Bullhorn active: ${bullhornActive}`);
        }
      } catch (err) {
        console.warn(`User sync: failed to check active status for ${config.config_id} (${config.user_name}):`, err);
      }
    }
  }
}

export const userSyncService = new UserSyncService();

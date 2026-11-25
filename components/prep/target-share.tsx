'use client';

import type { ShareSpec, Target } from '@/lib/plan';
import { MODE_INFO } from './state';
import { Check, Field, inputClass, Notice, Tile } from './ui';

export function Destination({ target, onChange, databases }: { target: Target; onChange: (patch: Partial<Target>) => void; databases: string[] }) {
  const exists = databases.some((d) => d.toUpperCase() === target.database.toUpperCase());
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Database" hint={target.database && !exists ? 'Not found — will be created.' : undefined}>
          <input
            className={inputClass}
            list="dest-dbs"
            value={target.database}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              onChange({ database: v, createDatabase: !databases.some((d) => d.toUpperCase() === v) });
            }}
            placeholder="SHARED_DATA"
          />
          <datalist id="dest-dbs">
            {databases.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </Field>
        <Field label="Schema">
          <input className={inputClass} value={target.schema} onChange={(e) => onChange({ schema: e.target.value.toUpperCase() })} placeholder="SHARE_PREP" />
        </Field>
        <Field label="Table name suffix" hint="Appended to each output table.">
          <input className={inputClass} value={target.suffix} onChange={(e) => onChange({ suffix: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="_SHARED" />
        </Field>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Check checked={target.createSchema || target.createDatabase} disabled={target.createDatabase} onChange={(v) => onChange({ createSchema: v })} label="Create schema if missing" hint="CREATE SCHEMA IF NOT EXISTS" />
        <Check checked={target.replace} onChange={(v) => onChange({ replace: v })} label="Replace existing tables" hint="Re-running the manifest overwrites earlier output." />
      </div>
      <Notice>Keep shared copies in a dedicated database. A share can only expose objects from the database it is granted on, so mixing shared and internal tables makes later audits harder.</Notice>
    </div>
  );
}

export function Distribution({ share, onChange, org }: { share: ShareSpec; onChange: (patch: Partial<ShareSpec>) => void; org: string | null }) {
  const accountsText = share.accounts.join(', ');
  const isOrg = share.mode === 'org_listing';
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Distribution">
        {(Object.keys(MODE_INFO) as ShareSpec['mode'][]).map((m) => (
          <Tile key={m} name="mode" value={m} current={share.mode} onSelect={(v) => onChange({ mode: v })} label={MODE_INFO[m].label} blurb={MODE_INFO[m].blurb} />
        ))}
      </div>

      {share.mode !== 'none' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Share name">
            <input className={inputClass} value={share.shareName} onChange={(e) => onChange({ shareName: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
          </Field>
          {(share.mode === 'private_listing' || isOrg) && (
            <Field label="Listing name" hint="Identifier, not shown to consumers.">
              <input className={inputClass} value={share.listingName} onChange={(e) => onChange({ listingName: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
            </Field>
          )}
        </div>
      )}

      {share.mode !== 'none' && !(isOrg && share.orgAllAccounts) && (
        <Field
          label={isOrg ? 'Accounts in your organization' : `Consumer accounts${share.mode === 'share' ? ' (optional)' : ''}`}
          hint={isOrg ? 'Account names, comma separated.' : `ORG_NAME.ACCOUNT_NAME, comma separated${org ? ` — e.g. ${org}.ANALYTICS` : ''}.`}
        >
          <input
            className={inputClass}
            defaultValue={accountsText}
            key={share.mode}
            onChange={(e) =>
              onChange({
                accounts: e.target.value
                  .split(/[,\s]+/)
                  .map((a) => a.trim())
                  .filter(Boolean),
              })
            }
            placeholder={isOrg ? 'FINANCE, MARKETING' : 'PARTNER_ORG.PROD_ACCOUNT'}
          />
        </Field>
      )}

      {(share.mode === 'private_listing' || isOrg) && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" hint="Shown to consumers. Max 110 characters.">
              <input className={`${inputClass} font-sans`} maxLength={110} value={share.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Customer orders (masked)" />
            </Field>
            {isOrg && (
              <Field label="Support contact (optional)">
                <input className={inputClass} type="email" value={share.supportContact} onChange={(e) => onChange({ supportContact: e.target.value })} placeholder="data-team@example.com" />
              </Field>
            )}
          </div>
          <Field label="Description">
            <textarea className={`${inputClass} h-20 py-2 font-sans`} value={share.description} onChange={(e) => onChange({ description: e.target.value })} placeholder="What the data contains and how it was protected." />
          </Field>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {isOrg && <Check checked={share.orgAllAccounts} onChange={(v) => onChange({ orgAllAccounts: v })} label="All internal accounts can access" />}
            <Check checked={share.publish} onChange={(v) => onChange({ publish: v })} label="Publish now" hint={share.publish ? 'Published immediately.' : 'Saved as a draft you can publish later.'} />
            <div className="grid gap-2">
              <Check checked={share.autoFulfill} onChange={(v) => onChange({ autoFulfill: v })} label="Cross-region auto-fulfillment" hint="Needed when consumers are in another region." />
              {share.autoFulfill && (
                <Field label="Refresh every (minutes)" className="max-w-40">
                  <input className={inputClass} type="number" min={10} max={11520} value={share.refreshMinutes} onChange={(e) => onChange({ refreshMinutes: Number(e.target.value) })} />
                </Field>
              )}
            </div>
          </div>
        </>
      )}

      {share.mode !== 'none' && <Notice>Creating shares and listings needs CREATE SHARE and CREATE LISTING (or CREATE ORGANIZATION LISTING). By default only ACCOUNTADMIN has them.</Notice>}
    </div>
  );
}

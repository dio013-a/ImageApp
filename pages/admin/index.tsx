import type { GetServerSideProps } from 'next';
import config from '../../lib/config';

interface Job {
  id: string;
  status: string;
  provider: string | null;
  created_at: string;
  updated_at: string;
  telegram_chat_id: string;
  provider_job_id: string | null;
  result_url: string | null;
  error: string | null;
}

interface Props {
  authorized: boolean;
  jobs: Job[];
  error?: string;
}

export default function AdminPage({ authorized, jobs, error }: Props) {
  if (!authorized) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace' }}>
        <h1>Unauthorized</h1>
        <p>Missing or invalid admin token.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px', fontFamily: 'monospace' }}>
        <h1>Error</h1>
        <p>{error}</p>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return '#22c55e';
      case 'failed':
        return '#ef4444';
      case 'running':
        return '#3b82f6';
      case 'pending':
        return '#a855f7';
      default:
        return '#6b7280';
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '14px' }}>
      <h1>Admin Dashboard</h1>
      <h2>Recent Jobs ({jobs.length})</h2>

      {jobs.length === 0 ? (
        <p>No jobs found.</p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginTop: '20px',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>ID</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Provider</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Created</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: '1px solid #eee' }}>
                <td
                  style={{
                    padding: '8px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                  }}
                >
                  {job.id.substring(0, 8)}...
                </td>
                <td style={{ padding: '8px' }}>
                  <span
                    style={{
                      color: getStatusColor(job.status),
                      fontWeight: 'bold',
                    }}
                  >
                    {job.status}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>{job.provider || '-'}</td>
                <td style={{ padding: '8px', fontSize: '12px' }}>
                  {new Date(job.created_at).toLocaleString()}
                </td>
                <td
                  style={{
                    padding: '8px',
                    fontSize: '11px',
                    color: '#ef4444',
                    maxWidth: '300px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {job.error || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  context: any,
) => {
  const token = context.query.token as string | undefined;

  if (!config.ADMIN_TOKEN || token !== config.ADMIN_TOKEN) {
    return {
      props: {
        authorized: false,
        jobs: [],
      },
    };
  }

  try {
    const baseUrl = config.BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/admin/jobs?limit=50`, {
      headers: {
        'x-admin-token': config.ADMIN_TOKEN,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch jobs: ${res.status}`);
    }

    const jobs = await res.json();

    return {
      props: {
        authorized: true,
        jobs,
      },
    };
  } catch (error) {
    return {
      props: {
        authorized: true,
        jobs: [],
        error: error instanceof Error ? error.message : 'Failed to load jobs',
      },
    };
  }
};

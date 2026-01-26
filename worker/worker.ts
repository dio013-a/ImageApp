import config from '../lib/config';
import { supabase } from '../lib/supabase';
import { deleteObject } from '../lib/storage';

let stopping = false;

async function gcExpiredImagesBatch(limit = 50): Promise<{ deleted: number }> {
  try {
    // Query expired images
    const { data: expiredImages, error } = await supabase
      .from('images')
      .select('*')
      .not('retention_expires_at', 'is', null)
      .lt('retention_expires_at', new Date().toISOString())
      .order('retention_expires_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`[worker:gc] Query failed: ${error.message}`);
    }

    if (!expiredImages || expiredImages.length === 0) {
      return { deleted: 0 };
    }

    let deleted = 0;

    for (const image of expiredImages) {
      try {
        // Delete from storage if path exists
        if (image.storage_bucket && image.storage_path) {
          try {
            await deleteObject({
              bucket: image.storage_bucket,
              path: image.storage_path,
            });
          } catch (storageError) {
            // Log but continue - object might already be deleted
            console.error(
              `[worker:gc] Storage delete failed for image ${image.id}:`,
              storageError instanceof Error
                ? storageError.message
                : String(storageError),
            );
          }
        }

        // Delete from database
        const { error: deleteError } = await supabase
          .from('images')
          .delete()
          .eq('id', image.id);

        if (deleteError) {
          console.error(
            `[worker:gc] DB delete failed for image ${image.id}:`,
            deleteError.message,
          );
        } else {
          deleted++;
        }
      } catch (imageError) {
        console.error(
          `[worker:gc] Error processing image ${image.id}:`,
          imageError instanceof Error ? imageError.message : String(imageError),
        );
      }
    }

    console.log(`[worker:gc] deleted=${deleted}`);
    return { deleted };
  } catch (error) {
    console.error(
      '[worker:gc] Batch failed:',
      error instanceof Error ? error.message : String(error),
    );
    return { deleted: 0 };
  }
}

// TODO: Implement provider polling for jobs that don't receive callbacks
async function pollRunningJobsBatch(limit = 20): Promise<void> {
  // Stub for now - we rely on provider webhooks in v0
  // Future: query jobs with status='running' and check provider status via API
  return;
}

async function mainLoop() {
  console.log('[worker] Started');
  console.log('[worker] Poll interval:', config.POLL_INTERVAL_MS, 'ms');

  while (!stopping) {
    try {
      // Run garbage collection
      await gcExpiredImagesBatch();

      // Run job polling (stub)
      await pollRunningJobsBatch();
    } catch (error) {
      console.error(
        '[worker] Loop iteration failed:',
        error instanceof Error ? error.message : String(error),
      );
    }

    // Sleep for configured interval
    await new Promise((resolve) =>
      setTimeout(resolve, config.POLL_INTERVAL_MS),
    );
  }

  console.log('[worker] Stopped gracefully');
}

// Graceful shutdown handlers
process.on('SIGINT', () => {
  console.log('[worker] Received SIGINT, stopping...');
  stopping = true;
});

process.on('SIGTERM', () => {
  console.log('[worker] Received SIGTERM, stopping...');
  stopping = true;
});

// Start the worker
mainLoop().catch((error) => {
  console.error('[worker] Fatal error:', error);
  process.exit(1);
});

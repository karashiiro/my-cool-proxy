<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import type { LuaExecution } from "$lib/types.js";

	let {
		executions,
		selectedId,
		onselect,
		hasMore = false,
		loadingMore = false,
		onloadmore,
	}: {
		executions: LuaExecution[];
		selectedId: string | null;
		onselect?: (id: string) => void;
		hasMore?: boolean;
		loadingMore?: boolean;
		onloadmore?: () => void;
	} = $props();

	function formatTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		if (diff < 0) return "just now";
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return `${seconds}s ago`;
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function truncateScript(script: string): string {
		const firstLine =
			script
				.split("\n")
				.map((l) => l.trim())
				.find((l) => l.length > 0) ?? script.trim();
		return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
	}
</script>

<div class="flex h-full flex-col overflow-hidden bg-card/50">
	<div class="section-header flex items-center gap-2 border-b border-border px-4 py-2.5">
		<svg class="size-3.5 text-primary/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
			<rect x="9" y="3" width="6" height="4" rx="1" />
		</svg>
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Executions</h2>
	</div>
	{#if executions.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-6">
			<svg class="size-8 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path d="M14.25 9.75L16.5 12l-2.25 2.25" />
				<path d="M9.75 9.75L7.5 12l2.25 2.25" />
				<circle cx="12" cy="12" r="10" />
			</svg>
			<span class="text-xs text-muted-foreground">No executions yet</span>
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="flex flex-col gap-0.5 p-1.5">
				{#each executions as execution (execution.executionId)}
					{@const isSelected = selectedId === execution.executionId}
					<button
						class="execution-item w-full rounded-lg px-3 py-2.5 text-left transition-all duration-150
							{isSelected ? 'selected' : 'hover:bg-accent/50'}"
						data-selected={isSelected ? "" : undefined}
						onclick={() => onselect?.(execution.executionId)}
					>
						<div class="flex items-start justify-between gap-2">
							<span class="truncate font-mono text-[11px] leading-relaxed text-foreground/85">
								{truncateScript(execution.script)}
							</span>
							<Badge
								variant={execution.status === "success" ? "default" : "destructive"}
								class="shrink-0 text-[9px] font-semibold uppercase tracking-wider {execution.status === 'success'
									? 'bg-success/15 text-success border-success/20'
									: ''}"
							>
								{execution.status}
							</Badge>
						</div>
						<div class="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
							<svg class="size-2.5 opacity-50" viewBox="0 0 16 16" fill="currentColor">
								<path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.5 4.5v4l3 1.5-.5 1-3.5-1.75V4.5h1z" />
							</svg>
							{formatTime(execution.createdAt)}
						</div>
					</button>
				{/each}
				{#if hasMore}
					<button
						class="mt-1 w-full rounded-lg px-3 py-2.5 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
						disabled={loadingMore}
						onclick={() => onloadmore?.()}
					>
						{#if loadingMore}
							Loading...
						{:else}
							Load more
						{/if}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.section-header {
		background: linear-gradient(
			180deg,
			oklch(0.17 0.015 260) 0%,
			oklch(0.15 0.012 260) 100%
		);
	}

	.execution-item.selected {
		background: oklch(0.2 0.02 260);
		box-shadow:
			inset 2px 0 0 oklch(0.78 0.145 70),
			0 0 12px -4px oklch(0.78 0.145 70 / 0.15);
	}
</style>

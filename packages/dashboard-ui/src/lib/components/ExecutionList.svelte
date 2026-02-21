<script lang="ts">
	import { Badge } from "$lib/components/ui/badge/index.js";
	import type { LuaExecution } from "$lib/types.js";

	let {
		executions,
		selectedId,
		onselect,
	}: {
		executions: LuaExecution[];
		selectedId: string | null;
		onselect?: (id: string) => void;
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

<div class="flex h-full flex-col overflow-hidden">
	<div class="border-b border-border px-3 py-2">
		<h2 class="text-sm font-semibold text-foreground">Executions</h2>
	</div>
	{#if executions.length === 0}
		<div
			class="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground"
		>
			No executions yet
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="flex flex-col gap-0.5 p-1">
				{#each executions as execution (execution.executionId)}
					<button
						class="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-accent {selectedId ===
						execution.executionId
							? 'bg-accent'
							: ''}"
						data-selected={selectedId === execution.executionId
							? ""
							: undefined}
						onclick={() => onselect?.(execution.executionId)}
					>
						<div class="flex items-center justify-between gap-2">
							<span
								class="truncate text-xs font-mono text-foreground"
							>
								{truncateScript(execution.script)}
							</span>
							<Badge
								variant={execution.status === "success"
									? "secondary"
									: "destructive"}
								class="shrink-0 text-[10px]"
							>
								{execution.status}
							</Badge>
						</div>
						<div class="mt-1 text-[10px] text-muted-foreground">
							{formatTime(execution.createdAt)}
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

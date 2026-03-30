<script lang="ts">
	import { Pane, PaneGroup, PaneResizer } from "paneforge";
	import { getContext, onMount } from "svelte";
	import ExecutionList from "$lib/components/ExecutionList.svelte";
	import CodeViewer from "$lib/components/CodeViewer.svelte";
	import ResultPane from "$lib/components/ResultPane.svelte";
	import { fetchExecutions, fetchToolCalls, fetchTools } from "$lib/api.js";
	import type { ToolUsage } from "$lib/api.js";
	import { preloadHighlighter } from "$lib/highlight.js";
	import type { LuaExecution, LuaToolCall } from "$lib/types.js";
	import type { DashboardWsClient } from "$lib/ws.js";

	const PAGE_SIZE = 50;

	let executions = $state<LuaExecution[]>([]);
	let totalExecutions = $state(0);
	let selectedExecution = $state<LuaExecution | null>(null);
	let toolCalls = $state<LuaToolCall[]>([]);
	let selectedToolCall = $state<LuaToolCall | null>(null);
	let loadError = $state<string | null>(null);
	let loadingMore = $state(false);
	let availableTools = $state<ToolUsage[]>([]);
	let toolFilter = $state<string | null>(null);

	let hasMore = $derived(executions.length < totalExecutions);

	let pendingCount = $state(0);

	const wsState = getContext<{ client: DashboardWsClient | null; connected: boolean }>('ws');

	/** Counter to guard against race conditions when rapidly selecting executions */
	let selectGeneration = 0;
	/** Counter to guard against race conditions when rapidly switching filters */
	let filterGeneration = 0;

	let resultLabel = $derived(
		selectedToolCall
			? `Tool Call: ${selectedToolCall.serverName}.${selectedToolCall.toolName}`
			: "Script Result"
	);

	let resultValue = $derived(
		selectedToolCall ? selectedToolCall.result : selectedExecution?.result
	);

	let errorValue = $derived(
		selectedToolCall ? selectedToolCall.error : selectedExecution?.error
	);

	async function selectExecution(executionId: string) {
		const exec = executions.find((e) => e.executionId === executionId);
		if (!exec) return;
		selectedExecution = exec;
		selectedToolCall = null;

		const generation = ++selectGeneration;
		try {
			const calls = await fetchToolCalls(executionId);
			// Only apply if this is still the most recent selection
			if (generation === selectGeneration) {
				toolCalls = calls;
			}
		} catch (err) {
			if (generation === selectGeneration) {
				toolCalls = [];
				loadError = err instanceof Error ? err.message : String(err);
			}
		}
	}

	function selectToolCall(tc: LuaToolCall | null) {
		selectedToolCall = tc;
	}

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		try {
			const page = await fetchExecutions(PAGE_SIZE, executions.length, toolFilter);
			executions = [...executions, ...page.executions];
			totalExecutions = page.total;
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			loadingMore = false;
		}
	}

	async function handleFilter(tool: string | null) {
		toolFilter = tool;
		selectedExecution = null;
		selectedToolCall = null;
		toolCalls = [];
		const generation = ++filterGeneration;
		try {
			const page = await fetchExecutions(PAGE_SIZE, 0, tool);
			if (generation !== filterGeneration) return;
			executions = page.executions;
			totalExecutions = page.total;
		} catch (err) {
			if (generation !== filterGeneration) return;
			loadError = err instanceof Error ? err.message : String(err);
		}
		// Refresh tool counts in the background
		loadTools();
	}

	async function loadTools() {
		try {
			availableTools = await fetchTools();
		} catch {
			// Tools list is non-critical; silently fall back to empty
		}
	}

	async function handleRefresh() {
		try {
			const page = await fetchExecutions(PAGE_SIZE, 0, toolFilter);
			executions = page.executions;
			totalExecutions = page.total;
			pendingCount = 0;
			wsState?.client?.clearPending();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
		loadTools();
	}

	onMount(async () => {
		// Pre-warm Shiki so first execution click doesn't freeze the UI
		preloadHighlighter();

		try {
			const page = await fetchExecutions(PAGE_SIZE);
			executions = page.executions;
			totalExecutions = page.total;
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}

		// Load tools list for filter dropdown (non-blocking)
		loadTools();

		// Subscribe to WS execution events when client becomes available
		let cleanupWs: (() => void) | null = null;
		const checkInterval = setInterval(() => {
			const client = wsState?.client;
			if (client) {
				clearInterval(checkInterval);
				const unsub = client.onExecutionNew(() => {
					pendingCount = client.pendingExecutions;
				});
				cleanupWs = unsub;
			}
		}, 100);

		return () => {
			clearInterval(checkInterval);
			cleanupWs?.();
		};
	});
</script>

<svelte:head>
	<title>Dashboard</title>
</svelte:head>

<div class="flex h-full w-full flex-col">
	{#if loadError}
		<div
			class="absolute top-12 right-3 z-50 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-red-400 shadow-lg backdrop-blur-sm"
		>
			<svg class="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
				<path
					d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4.75a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0v-3zm.75 6a.75.75 0 110-1.5.75.75 0 010 1.5z"
				/>
			</svg>
			{loadError}
			<button
				class="ml-1 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
				aria-label="Dismiss error"
				onclick={() => (loadError = null)}
			>
				<svg class="size-3" viewBox="0 0 16 16" fill="currentColor">
					<path
						d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"
					/>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Header bar -->
	<header class="header-bar flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
		<div class="flex items-center gap-2">
			<svg class="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M12 2L2 7l10 5 10-5-10-5z" />
				<path d="M2 17l10 5 10-5" />
				<path d="M2 12l10 5 10-5" />
			</svg>
			<span class="text-sm font-semibold tracking-tight text-foreground">MCP Gateway</span>
		</div>
		<div class="h-4 w-px bg-border"></div>
		<span class="text-xs font-medium text-muted-foreground">Execution Dashboard</span>
		<div class="ml-auto flex items-center gap-2">
			<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
				<span class="inline-block size-1.5 rounded-full bg-success animate-pulse"></span>
				{totalExecutions} execution{totalExecutions === 1 ? "" : "s"}{toolFilter ? " (filtered)" : ""}
			</div>
		</div>
	</header>

	<!-- Main content — min-h-0 prevents flex items from overflowing the viewport -->
	<div class="min-h-0 flex-1 overflow-hidden">
		<PaneGroup direction="horizontal" class="h-full">
			<Pane defaultSize={25} minSize={15} maxSize={40}>
				<ExecutionList
					{executions}
					selectedId={selectedExecution?.executionId ?? null}
					onselect={selectExecution}
					{hasMore}
					{loadingMore}
					onloadmore={loadMore}
					tools={availableTools}
					activeFilter={toolFilter}
					onfilter={handleFilter}
					{pendingCount}
					onrefresh={handleRefresh}
				/>
			</Pane>
			<PaneResizer class="resizer-v group relative w-1.5 transition-colors" />
			<Pane defaultSize={75}>
				<PaneGroup direction="vertical" class="h-full">
					<Pane defaultSize={60} minSize={20}>
						<CodeViewer
							script={selectedExecution?.script ?? ""}
							{toolCalls}
							ontoolcallclick={selectToolCall}
						/>
					</Pane>
					<PaneResizer class="resizer-h group relative h-1.5 transition-colors" />
					<Pane defaultSize={40} minSize={15}>
						<ResultPane
							result={resultValue}
							error={errorValue}
							label={resultLabel}
						/>
					</Pane>
				</PaneGroup>
			</Pane>
		</PaneGroup>
	</div>
</div>

<style>
	.header-bar {
		background: linear-gradient(
			180deg,
			oklch(0.17 0.015 260) 0%,
			oklch(0.14 0.012 260) 100%
		);
	}

</style>

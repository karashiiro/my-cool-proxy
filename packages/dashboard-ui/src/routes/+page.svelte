<script lang="ts">
	import { Pane, PaneGroup, PaneResizer } from "paneforge";
	import { onMount } from "svelte";
	import ExecutionList from "$lib/components/ExecutionList.svelte";
	import CodeViewer from "$lib/components/CodeViewer.svelte";
	import ResultPane from "$lib/components/ResultPane.svelte";
	import { fetchExecutions, fetchToolCalls } from "$lib/api.js";
	import type { LuaExecution, LuaToolCall } from "$lib/types.js";

	let executions = $state<LuaExecution[]>([]);
	let selectedExecution = $state<LuaExecution | null>(null);
	let toolCalls = $state<LuaToolCall[]>([]);
	let selectedToolCall = $state<LuaToolCall | null>(null);
	let loadError = $state<string | null>(null);

	/** Counter to guard against race conditions when rapidly selecting executions */
	let selectGeneration = 0;

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

	onMount(async () => {
		try {
			executions = await fetchExecutions();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
	});
</script>

<svelte:head>
	<title>Dashboard</title>
</svelte:head>

<div class="h-screen w-screen">
	{#if loadError}
		<div class="absolute top-2 right-2 z-50 rounded-md bg-destructive/90 px-3 py-2 text-xs text-destructive-foreground shadow-lg">
			{loadError}
			<button class="ml-2 font-bold" onclick={() => (loadError = null)}>×</button>
		</div>
	{/if}
	<PaneGroup direction="horizontal" class="h-full">
		<Pane defaultSize={25} minSize={15} maxSize={40}>
			<ExecutionList
				{executions}
				selectedId={selectedExecution?.executionId ?? null}
				onselect={selectExecution}
			/>
		</Pane>
		<PaneResizer class="w-1 bg-border hover:bg-ring transition-colors" />
		<Pane defaultSize={75}>
			<PaneGroup direction="vertical" class="h-full">
				<Pane defaultSize={60} minSize={20}>
					<CodeViewer
						script={selectedExecution?.script ?? ""}
						{toolCalls}
						ontoolcallclick={selectToolCall}
					/>
				</Pane>
				<PaneResizer class="h-1 bg-border hover:bg-ring transition-colors" />
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

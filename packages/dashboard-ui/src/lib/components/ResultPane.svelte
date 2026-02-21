<script lang="ts">
	import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

	let {
		result,
		error,
		label,
	}: {
		result: string | undefined | null;
		error: string | undefined | null;
		label: string;
	} = $props();

	let parsedJson = $derived.by(() => {
		if (!result) return null;
		try {
			return JSON.parse(result);
		} catch {
			return null;
		}
	});

	let isRawText = $derived(!parsedJson && !!result);
</script>

<div class="flex h-full flex-col">
	<div class="border-b border-border px-3 py-2">
		<h2 class="text-sm font-semibold text-foreground">{label}</h2>
	</div>
	{#if error}
		<ScrollArea class="flex-1">
			<div class="p-3">
				<div class="rounded-md bg-destructive/10 p-3 text-sm text-red-400 font-mono whitespace-pre-wrap">
					{error}
				</div>
			</div>
		</ScrollArea>
	{:else if parsedJson !== null}
		<ScrollArea class="flex-1">
			<div class="p-3">
				<pre class="text-sm font-mono text-foreground whitespace-pre-wrap">{JSON.stringify(parsedJson, null, 2)}</pre>
			</div>
		</ScrollArea>
	{:else if isRawText}
		<ScrollArea class="flex-1">
			<div class="p-3">
				<pre class="text-sm font-mono text-foreground whitespace-pre-wrap">{result}</pre>
			</div>
		</ScrollArea>
	{:else}
		<div class="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
			No result to display
		</div>
	{/if}
</div>

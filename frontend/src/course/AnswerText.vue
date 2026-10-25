<script setup lang="ts">
import { computed } from 'vue';
const props=defineProps<{text:string}>();
defineEmits<{cite:[number:number]}>();
const blocks=computed(()=>props.text.split('\n').map(line=>{
 const list=/^\s*[-*] /.test(line);const content=line.replace(/^\s*[-*] /,'');
 const tokens:{type:string;text:string;number?:number}[]=[];let start=0;
 for(const match of content.matchAll(/\*\*([^*]+)\*\*|\[(\d+)\]/g)){
  if(match.index>start)tokens.push({type:'text',text:content.slice(start,match.index)});
  tokens.push(match[1]?{type:'bold',text:match[1]}:{type:'cite',text:match[0],number:Number(match[2])});start=match.index+match[0].length;
 }
 if(start<content.length)tokens.push({type:'text',text:content.slice(start)});
 return {list,tokens};
}));
</script>
<template><div class="prose answer-prose"><p v-for="(block,i) in blocks" :key="i" :class="{'answer-list':block.list}"><span v-if="block.list" aria-hidden="true">• </span><template v-for="(token,j) in block.tokens" :key="j"><strong v-if="token.type==='bold'">{{token.text}}</strong><button v-else-if="token.type==='cite'" class="citation-link" @click="$emit('cite',token.number!)">{{token.text}}</button><span v-else>{{token.text}}</span></template></p></div></template>

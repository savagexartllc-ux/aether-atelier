(function(){
var $=function(i){return document.getElementById(i)};
var y=$("y");if(y)y.textContent=new Date().getFullYear();
var cf=$("cf");
if(cf)cf.onsubmit=function(e){e.preventDefault();var f=e.target,b="Name: "+f.n.value+"\nSize: "+f.s.value+"\nColours: "+f.c.value+"\nVision: "+f.v.value+"\nReply to: "+f.e.value;location.href="mailto:L.AetherApothecary@gmail.com?subject="+encodeURIComponent("Commission request")+"&body="+encodeURIComponent(b)};
var sz=$("sz");
if(sz){var calc=function(){var b=+$("sz").value,p=+$("pk").value,z=+$("zn").value,i=+$("iv").value||0,t=b*p*z+i*.012;$("ship").textContent="\u2248 $"+t.toFixed(2)+" shipping"};["sz","pk","zn","iv"].forEach(function(i){$(i).oninput=calc});calc()}
var nl=$("nl");
if(nl)nl.onsubmit=function(e){e.preventDefault();location.href="mailto:L.AetherApothecary@gmail.com?subject="+encodeURIComponent("Join the Society")+"&body="+encodeURIComponent("Please add me to the Society: "+nl.e.value)};
})();

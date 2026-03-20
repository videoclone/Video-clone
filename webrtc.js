import { db, ref, set, onValue } from './firebase.js';

const servers = {
    iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
    ]
};

export let localStream;
export let remoteStream;
export let peerConnection;

export async function setupMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
        return true;
    } catch (error) {
        console.error("Media access error:", error);
        Swal.fire('Camera Error', 'Please allow camera and microphone permissions.', 'error');
        return false;
    }
}

export function createPeerConnection(callId, isCaller) {
    peerConnection = new RTCPeerConnection(servers);
    remoteStream = new MediaStream();
    document.getElementById('remote-video').srcObject = remoteStream;

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
        });
        document.getElementById('status-overlay').style.display = 'none';
        
        let sound = document.getElementById('connect-sound');
        if(sound) sound.play().catch(e => console.log("Audio play blocked", e));
        
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success',
            title: 'Connected!', showConfirmButton: false, timer: 2000
        });
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            const role = isCaller ? 'caller' : 'callee';
            const candidateRef = ref(db, `calls/${callId}/candidates/${role}_${Date.now()}`);
            set(candidateRef, event.candidate.toJSON());
        }
    };
    
    peerConnection.oniceconnectionstatechange = () => {
        if(peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            document.getElementById('btn-end').click();
        }
    }
}

export async function createOffer(callId) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await set(ref(db, `calls/${callId}/offer`), { type: offer.type, sdp: offer.sdp });

    onValue(ref(db, `calls/${callId}/answer`), (snapshot) => {
        const data = snapshot.val();
        if (data && !peerConnection.currentRemoteDescription) {
            peerConnection.setRemoteDescription(new RTCSessionDescription(data));
        }
    });

    onValue(ref(db, `calls/${callId}/candidates`), (snapshot) => {
        snapshot.forEach((child) => {
            if (child.key.startsWith('callee_')) {
                peerConnection.addIceCandidate(new RTCIceCandidate(child.val())).catch(e=>console.log(e));
            }
        });
    });
}

export async function answerOffer(callId, offerData) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await set(ref(db, `calls/${callId}/answer`), { type: answer.type, sdp: answer.sdp });

    onValue(ref(db, `calls/${callId}/candidates`), (snapshot) => {
        snapshot.forEach((child) => {
            if (child.key.startsWith('caller_')) {
                peerConnection.addIceCandidate(new RTCIceCandidate(child.val())).catch(e=>console.log(e));
            }
        });
    });
}

export function closeConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
}

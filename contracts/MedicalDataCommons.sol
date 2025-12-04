// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MedicalDataCommons is SepoliaConfig {
    // Encrypted medical data record
    struct EncryptedMedicalRecord {
        euint32 encryptedPatientId;   // Encrypted patient identifier
        euint32 encryptedDiagnosis;    // Encrypted diagnosis code
        euint32 encryptedTreatment;    // Encrypted treatment code
        euint32 encryptedOutcome;       // Encrypted treatment outcome
        uint256 timestamp;              // Record creation time
        address submitter;              // Data submitter
    }
    
    // Research query structure
    struct ResearchQuery {
        euint32 encryptedQuery;        // Encrypted query parameters
        euint32 encryptedResult;       // Encrypted query result
        uint256 timestamp;              // Query time
        bool isProcessed;              // Processing status
    }
    
    // Contract state
    uint256 public recordCount;
    mapping(uint256 => EncryptedMedicalRecord) public medicalRecords;
    mapping(address => ResearchQuery) public researchQueries;
    
    // DAO governance
    struct GovernanceProposal {
        string description;            // Proposal description
        uint256 voteCount;              // Total votes
        uint256 endTime;                // Voting deadline
        bool isExecuted;                // Execution status
    }
    
    mapping(uint256 => GovernanceProposal) public governanceProposals;
    mapping(uint256 => mapping(address => bool)) public votes;
    uint256 public proposalCount;
    
    // Access control
    enum ParticipantType { Patient, Hospital, Researcher }
    mapping(address => ParticipantType) public participantTypes;
    
    // Events
    event RecordSubmitted(uint256 indexed recordId, address submitter);
    event QuerySubmitted(address indexed researcher);
    event QueryProcessed(address indexed researcher);
    event ProposalCreated(uint256 indexed proposalId);
    event Voted(uint256 indexed proposalId, address voter);
    event ProposalExecuted(uint256 indexed proposalId);
    
    // Only registered participants
    modifier onlyParticipant() {
        require(participantTypes[msg.sender] != ParticipantType(0), "Not registered");
        _;
    }
    
    // Only researchers
    modifier onlyResearcher() {
        require(participantTypes[msg.sender] == ParticipantType.Researcher, "Not researcher");
        _;
    }
    
    // Only patients or hospitals
    modifier onlyDataContributor() {
        ParticipantType pType = participantTypes[msg.sender];
        require(pType == ParticipantType.Patient || pType == ParticipantType.Hospital, "Not contributor");
        _;
    }
    
    /// @notice Register participant type
    function registerParticipant(ParticipantType pType) public {
        require(participantTypes[msg.sender] == ParticipantType(0), "Already registered");
        participantTypes[msg.sender] = pType;
    }
    
    /// @notice Submit encrypted medical record
    function submitMedicalRecord(
        euint32 patientId,
        euint32 diagnosis,
        euint32 treatment,
        euint32 outcome
    ) public onlyDataContributor {
        uint256 newId = ++recordCount;
        
        medicalRecords[newId] = EncryptedMedicalRecord({
            encryptedPatientId: patientId,
            encryptedDiagnosis: diagnosis,
            encryptedTreatment: treatment,
            encryptedOutcome: outcome,
            timestamp: block.timestamp,
            submitter: msg.sender
        });
        
        emit RecordSubmitted(newId, msg.sender);
    }
    
    /// @notice Submit research query
    function submitResearchQuery(euint32 encryptedQuery) public onlyResearcher {
        researchQueries[msg.sender] = ResearchQuery({
            encryptedQuery: encryptedQuery,
            encryptedResult: FHE.asEuint32(0),
            timestamp: block.timestamp,
            isProcessed: false
        });
        
        emit QuerySubmitted(msg.sender);
    }
    
    /// @notice Process research query
    function processQuery(address researcher) public {
        require(researchQueries[researcher].timestamp > 0, "No active query");
        require(!researchQueries[researcher].isProcessed, "Already processed");
        
        // Prepare encrypted data for computation
        bytes32[] memory ciphertexts = new bytes32[](recordCount * 4 + 1);
        
        // Add query parameters
        ciphertexts[0] = FHE.toBytes32(researchQueries[researcher].encryptedQuery);
        
        // Add all medical records
        uint256 index = 1;
        for (uint256 i = 1; i <= recordCount; i++) {
            EncryptedMedicalRecord storage record = medicalRecords[i];
            ciphertexts[index++] = FHE.toBytes32(record.encryptedPatientId);
            ciphertexts[index++] = FHE.toBytes32(record.encryptedDiagnosis);
            ciphertexts[index++] = FHE.toBytes32(record.encryptedTreatment);
            ciphertexts[index++] = FHE.toBytes32(record.encryptedOutcome);
        }
        
        // Request computation
        uint256 reqId = FHE.requestComputation(ciphertexts, this.executeQuery.selector);
    }
    
    /// @notice Callback for query execution
    function executeQuery(
        uint256 requestId,
        bytes memory results,
        bytes memory proof
    ) public {
        // Verify computation proof
        FHE.checkSignatures(requestId, results, proof);
        
        // Process query result
        euint32 encryptedResult = FHE.asEuint32(abi.decode(results, (uint32)));
        address researcher = msg.sender;
        
        researchQueries[researcher].encryptedResult = encryptedResult;
        researchQueries[researcher].isProcessed = true;
        
        emit QueryProcessed(researcher);
    }
    
    /// @notice Create governance proposal
    function createProposal(string memory description, uint256 votingPeriod) public onlyParticipant {
        uint256 newId = ++proposalCount;
        
        governanceProposals[newId] = GovernanceProposal({
            description: description,
            voteCount: 0,
            endTime: block.timestamp + votingPeriod,
            isExecuted: false
        });
        
        emit ProposalCreated(newId);
    }
    
    /// @notice Vote on governance proposal
    function voteOnProposal(uint256 proposalId, bool support) public onlyParticipant {
        GovernanceProposal storage proposal = governanceProposals[proposalId];
        require(block.timestamp < proposal.endTime, "Voting ended");
        require(!votes[proposalId][msg.sender], "Already voted");
        
        votes[proposalId][msg.sender] = true;
        if (support) {
            proposal.voteCount++;
        }
        
        emit Voted(proposalId, msg.sender);
    }
    
    /// @notice Execute governance proposal
    function executeProposal(uint256 proposalId) public {
        GovernanceProposal storage proposal = governanceProposals[proposalId];
        require(block.timestamp >= proposal.endTime, "Voting ongoing");
        require(!proposal.isExecuted, "Already executed");
        
        // Simple majority execution logic
        // In real implementation, add custom execution logic per proposal
        proposal.isExecuted = true;
        
        emit ProposalExecuted(proposalId);
    }
    
    /// @notice Get encrypted query result
    function getEncryptedResult() public view onlyResearcher returns (euint32) {
        require(researchQueries[msg.sender].isProcessed, "Query not processed");
        return researchQueries[msg.sender].encryptedResult;
    }
    
    /// @notice Request result decryption
    function requestResultDecryption() public onlyResearcher {
        require(researchQueries[msg.sender].isProcessed, "Query not processed");
        
        // Prepare encrypted result for decryption
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(researchQueries[msg.sender].encryptedResult);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptResult.selector);
    }
    
    /// @notice Callback for decrypted result
    function decryptResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted result
        uint32 result = abi.decode(cleartexts, (uint32));
        // Handle decrypted result as needed
    }
}
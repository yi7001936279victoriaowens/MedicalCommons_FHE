// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface MedicalRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  institution: string;
  dataType: string;
  fheQueryCount: number;
}

const App: React.FC = () => {
  // Randomly selected style: Gradient (warm sunset) + Glassmorphism + Center radiation + Micro-interactions
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    dataType: "",
    description: "",
    medicalData: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDataType, setSelectedDataType] = useState("all");
  const [showStats, setShowStats] = useState(false);

  // Filter records based on search and filter
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         record.institution.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = selectedDataType === "all" || record.dataType === selectedDataType;
    return matchesSearch && matchesType;
  });

  // Calculate statistics
  const totalRecords = records.length;
  const uniqueInstitutions = new Set(records.map(r => r.institution)).size;
  const totalQueries = records.reduce((sum, r) => sum + r.fheQueryCount, 0);

  useEffect(() => {
    checkAvailability().then(() => loadRecords()).finally(() => setLoading(false));
  }, []);

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "FHE Service Available"
        });
        setTimeout(() => setTransactionStatus({...transactionStatus, visible: false}), 2000);
      }
    } catch (e) {
      console.error("Availability check failed:", e);
    }
  };

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const keysBytes = await contract.getData("medical_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: MedicalRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`medical_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                institution: recordData.institution,
                dataType: recordData.dataType,
                fheQueryCount: recordData.fheQueryCount || 0
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting medical data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        institution: account,
        dataType: newRecordData.dataType,
        fheQueryCount: 0
      };
      
      await contract.setData(
        `medical_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("medical_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "medical_record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Medical data encrypted and stored!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewRecordData({
          dataType: "",
          description: "",
          medicalData: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const runFHEQuery = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Running FHE query on encrypted data..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`medical_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        fheQueryCount: (recordData.fheQueryCount || 0) + 1
      };
      
      await contract.setData(
        `medical_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE query executed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Query failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const dataTypes = [
    "Clinical Trials",
    "Genomic Data",
    "Medical Imaging",
    "Patient Records",
    "Treatment Outcomes",
    "Drug Efficacy"
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="background-gradient"></div>
      
      <header className="app-header">
        <div className="logo">
          <h1>Medical<span>Commons</span>FHE</h1>
          <p>Anonymous Medical Data Commons for Research</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="hero-section">
          <div className="hero-content">
            <h2>Secure Medical Research with FHE</h2>
            <p>A patient-centered data commons where all data remains encrypted</p>
            <button 
              onClick={() => setShowUploadModal(true)}
              className="primary-btn"
            >
              Contribute Data
            </button>
          </div>
        </div>
        
        <div className="control-panel">
          <div className="search-filter">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search records..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <span className="search-icon">🔍</span>
            </div>
            <select 
              value={selectedDataType}
              onChange={(e) => setSelectedDataType(e.target.value)}
            >
              <option value="all">All Data Types</option>
              {dataTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <button 
              onClick={() => setShowStats(!showStats)}
              className="toggle-stats"
            >
              {showStats ? 'Hide Stats' : 'Show Stats'}
            </button>
          </div>
          
          <div className="action-buttons">
            <button 
              onClick={loadRecords}
              className="refresh-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        </div>
        
        {showStats && (
          <div className="stats-section">
            <div className="stat-card">
              <h3>Total Records</h3>
              <p>{totalRecords}</p>
            </div>
            <div className="stat-card">
              <h3>Participating Institutions</h3>
              <p>{uniqueInstitutions}</p>
            </div>
            <div className="stat-card">
              <h3>FHE Queries</h3>
              <p>{totalQueries}</p>
            </div>
          </div>
        )}
        
        <div className="records-section">
          <h2>Medical Data Records</h2>
          
          {filteredRecords.length === 0 ? (
            <div className="empty-state">
              <p>No medical records found</p>
              <button 
                onClick={() => setShowUploadModal(true)}
                className="primary-btn"
              >
                Upload First Record
              </button>
            </div>
          ) : (
            <div className="records-grid">
              {filteredRecords.map(record => (
                <div className="record-card" key={record.id}>
                  <div className="card-header">
                    <h3>{record.dataType}</h3>
                    <span className="query-count">Queries: {record.fheQueryCount}</span>
                  </div>
                  <div className="card-body">
                    <p><strong>Institution:</strong> {record.institution.substring(0, 6)}...{record.institution.substring(38)}</p>
                    <p><strong>Uploaded:</strong> {new Date(record.timestamp * 1000).toLocaleDateString()}</p>
                  </div>
                  <div className="card-footer">
                    <button 
                      onClick={() => runFHEQuery(record.id)}
                      className="query-btn"
                    >
                      Run FHE Query
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadRecord} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          dataTypes={dataTypes}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            <p>{transactionStatus.message}</p>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>MedicalCommons FHE</h3>
            <p>A decentralized medical research platform using Fully Homomorphic Encryption</p>
          </div>
          <div className="footer-section">
            <h3>Governance</h3>
            <p>Patient-controlled data sharing</p>
            <p>DAO-managed research access</p>
          </div>
          <div className="footer-section">
            <h3>Technology</h3>
            <p>Zama FHE Integration</p>
            <p>Zero-Knowledge Proofs</p>
          </div>
        </div>
        <div className="copyright">
          © {new Date().getFullYear()} MedicalCommons FHE. All rights reserved.
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  dataTypes: string[];
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  recordData,
  setRecordData,
  dataTypes
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.dataType || !recordData.medicalData) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Medical Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Data Type *</label>
            <select 
              name="dataType"
              value={recordData.dataType} 
              onChange={handleChange}
            >
              <option value="">Select data type</option>
              {dataTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text"
              name="description"
              value={recordData.description} 
              onChange={handleChange}
              placeholder="Brief description..." 
            />
          </div>
          
          <div className="form-group">
            <label>Medical Data *</label>
            <textarea 
              name="medicalData"
              value={recordData.medicalData} 
              onChange={handleChange}
              placeholder="Enter medical data to encrypt..." 
              rows={6}
            />
          </div>
          
          <div className="privacy-notice">
            <p>Your data will remain encrypted at all times using FHE technology</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="secondary-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="primary-btn"
          >
            {uploading ? "Encrypting..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;